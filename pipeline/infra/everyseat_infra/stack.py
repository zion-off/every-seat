"""Everything the cloud pipeline needs except the AgentCore runtime itself.

A film uploaded under `incoming/` in the media bucket raises an EventBridge event; the trigger
Lambda starts a job in the AgentCore runtime; the runtime runs the detectors and the Nova agent,
and runs the flash analyzer as a one-off Fargate task. Results and `status.json` land in the
results bucket. Everything is removed by `cdk destroy`.

The stack knows no account, region or VPC: the network arrives as context and nothing is looked up.
"""

from pathlib import Path

from aws_cdk import Aws, CfnOutput, Duration, RemovalPolicy, Stack
from aws_cdk import aws_ec2 as ec2
from aws_cdk import aws_ecr as ecr
from aws_cdk import aws_ecs as ecs
from aws_cdk import aws_events as events
from aws_cdk import aws_events_targets as targets
from aws_cdk import aws_iam as iam
from aws_cdk import aws_lambda as lambda_
from aws_cdk import aws_logs as logs
from aws_cdk import aws_s3 as s3
from constructs import Construct

from everyseat_infra.config import Settings

TRIGGER_DIR = Path(__file__).resolve().parent.parent / "trigger"
IRIS_IMAGE_TAG = "1.1.0"
IRIS_CONTAINER = "iris"  # the name the pipeline overrides the command of
INCOMING_PREFIX = "incoming/"
CLUSTER_NAME = "everyseat"
IRIS_FAMILY = "everyseat-iris"
IRIS_TASK_ROLE = "everyseat-iris-task"
IRIS_EXECUTION_ROLE = "everyseat-iris-execution"


class EverySeatStack(Stack):
    def __init__(self, scope: Construct, construct_id: str, *, settings: Settings) -> None:
        super().__init__(scope, construct_id)
        self.settings = settings

        media = self._bucket(
            "Media", f"everyseat-media-{Aws.ACCOUNT_ID}-{Aws.REGION}", emits_events=True
        )
        results = self._bucket(
            "Results", f"everyseat-results-{Aws.ACCOUNT_ID}-{Aws.REGION}", emits_events=False
        )
        # Flash analyzer staging: the proxy and the results archive of each run.
        results.add_lifecycle_rule(prefix="work/", expiration=Duration.days(1))

        iris_repo = self._repository("IrisRepository", "everyseat/iris")
        agent_repo = self._repository("AgentRepository", "everyseat/agent")
        cluster, security_group = self._iris_cluster()
        iris_logs = self._iris_task(iris_repo)
        trigger = self._trigger(media, results, cluster, security_group)

        rule = events.Rule(
            self,
            "FilmUploaded",
            description="A film was uploaded for analysis",
            event_pattern=events.EventPattern(
                source=["aws.s3"],
                detail_type=["Object Created"],
                detail={
                    "bucket": {"name": [media.bucket_name]},
                    "object": {"key": [{"prefix": INCOMING_PREFIX}]},
                },
            ),
        )
        rule.add_target(targets.LambdaFunction(trigger, retry_attempts=2))

        CfnOutput(self, "MediaBucket", value=media.bucket_name)
        CfnOutput(self, "ResultsBucket", value=results.bucket_name)
        CfnOutput(self, "IrisRepositoryUri", value=iris_repo.repository_uri)
        CfnOutput(self, "AgentRepositoryUri", value=agent_repo.repository_uri)
        CfnOutput(self, "IrisImageTag", value=IRIS_IMAGE_TAG)
        CfnOutput(self, "ClusterName", value=CLUSTER_NAME)
        CfnOutput(self, "IrisLogGroup", value=iris_logs.log_group_name)
        CfnOutput(self, "TriggerFunction", value=trigger.function_name)
        CfnOutput(self, "TriggerLogGroup", value=trigger.log_group.log_group_name)

    def _bucket(self, construct_id: str, name: str, *, emits_events: bool) -> s3.Bucket:
        return s3.Bucket(
            self,
            construct_id,
            bucket_name=name,
            event_bridge_enabled=emits_events,
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
            enforce_ssl=True,
            encryption=s3.BucketEncryption.S3_MANAGED,
            removal_policy=RemovalPolicy.DESTROY,
            auto_delete_objects=True,
            lifecycle_rules=[
                s3.LifecycleRule(abort_incomplete_multipart_upload_after=Duration.days(1))
            ],
        )

    def _repository(self, construct_id: str, name: str) -> ecr.Repository:
        return ecr.Repository(
            self,
            construct_id,
            repository_name=name,
            image_scan_on_push=True,
            removal_policy=RemovalPolicy.DESTROY,
            empty_on_delete=True,
            lifecycle_rules=[ecr.LifecycleRule(max_image_count=3)],
        )

    def _iris_cluster(self) -> tuple[ecs.CfnCluster, ec2.CfnSecurityGroup]:
        # The L2 Cluster creates a VPC with NAT gateways when it is not given one, so the cluster
        # and the security group are declared directly against the VPC passed as context.
        cluster = ecs.CfnCluster(self, "Cluster", cluster_name=CLUSTER_NAME)
        security_group = ec2.CfnSecurityGroup(
            self,
            "IrisSecurityGroup",
            group_description="Flash analyzer tasks: outbound only",
            vpc_id=self.settings.vpc_id,
        )
        return cluster, security_group

    def _iris_task(self, repository: ecr.Repository) -> logs.LogGroup:
        assumed_by = iam.ServicePrincipal("ecs-tasks.amazonaws.com")
        log_group = logs.LogGroup(
            self,
            "IrisLogs",
            retention=logs.RetentionDays.ONE_WEEK,
            removal_policy=RemovalPolicy.DESTROY,
        )
        task = ecs.FargateTaskDefinition(
            self,
            "IrisTask",
            family=IRIS_FAMILY,
            cpu=2048,
            memory_limit_mib=4096,
            ephemeral_storage_gib=50,
            runtime_platform=ecs.RuntimePlatform(
                cpu_architecture=ecs.CpuArchitecture.X86_64,
                operating_system_family=ecs.OperatingSystemFamily.LINUX,
            ),
            # Fixed names so the runtime's role can be allowed to pass exactly these two.
            task_role=iam.Role(
                self, "IrisTaskRole", role_name=IRIS_TASK_ROLE, assumed_by=assumed_by
            ),
            execution_role=iam.Role(
                self, "IrisExecutionRole", role_name=IRIS_EXECUTION_ROLE, assumed_by=assumed_by
            ),
        )
        task.add_container(
            IRIS_CONTAINER,
            image=ecs.ContainerImage.from_ecr_repository(repository, IRIS_IMAGE_TAG),
            entry_point=["/usr/local/bin/iris-task"],
            logging=ecs.LogDrivers.aws_logs(stream_prefix="iris", log_group=log_group),
        )
        return log_group

    def _trigger(
        self,
        media: s3.Bucket,
        results: s3.Bucket,
        cluster: ecs.CfnCluster,
        security_group: ec2.CfnSecurityGroup,
    ) -> lambda_.Function:
        function = lambda_.Function(
            self,
            "Trigger",
            runtime=lambda_.Runtime.PYTHON_3_12,
            architecture=lambda_.Architecture.ARM_64,
            handler="handler.handler",
            code=lambda_.Code.from_asset(str(TRIGGER_DIR), exclude=["__pycache__"]),
            timeout=Duration.seconds(120),
            memory_size=128,
            retry_attempts=2,
            log_group=logs.LogGroup(
                self,
                "TriggerLogs",
                retention=logs.RetentionDays.ONE_WEEK,
                removal_policy=RemovalPolicy.DESTROY,
            ),
            environment={
                "RESULTS_BUCKET": results.bucket_name,
                "AGENT_RUNTIME_ARN": self.settings.agent_runtime_arn,
                "IRIS_CLUSTER": cluster.ref,
                "IRIS_TASK_DEFINITION": IRIS_FAMILY,
                "IRIS_SUBNETS": ",".join(self.settings.subnet_ids),
                "IRIS_SECURITY_GROUP": security_group.attr_group_id,
            },
        )
        function.add_to_role_policy(
            iam.PolicyStatement(
                actions=["s3:PutObject"], resources=[results.arn_for_objects("jobs/*")]
            )
        )
        if self.settings.agent_runtime_arn:
            function.add_to_role_policy(
                iam.PolicyStatement(
                    actions=["bedrock-agentcore:InvokeAgentRuntime"],
                    resources=[
                        self.settings.agent_runtime_arn,
                        f"{self.settings.agent_runtime_arn}/runtime-endpoint/*",
                    ],
                )
            )
        return function
