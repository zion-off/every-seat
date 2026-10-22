# Cloud deployment

Runs the analysis pipeline in AWS. A film uploaded to the media bucket starts a job; the job writes
its cue file and a `status.json` to the results bucket.

```
  s3://<media>/incoming/film.mp4
        │  Object Created (EventBridge)
        ▼
  Lambda "Trigger" ── writes jobs/<job>/status.json (queued) ──► results bucket
        │  signed InvokeAgentRuntime, one session per job
        ▼
  AgentCore Runtime "analyzer" (arm64 container, everyseat/cloud/app.py)
        │  returns {"status":"accepted"} at once; the analysis continues in the session
        ├── detectors (ffmpeg) and the Strands agent on Amazon Nova Pro (Bedrock)
        ├── flash analyzer: one Fargate x86 task per run (ECS cluster "everyseat")
        └── writes .sensevtt, .recipe.json, .run.json and status.json ──► results bucket
```

Two stacks make this up, deployed by two tools:

| Stack | Tool | Contents |
|-------|------|----------|
| `EverySeat` | CDK app in this directory (Python) | buckets, upload rule, trigger Lambda, ECR repos, ECS cluster, flash analyzer task definition, IAM roles |
| `AgentCore-everyseat-default` | `@aws/agentcore` CLI, project in `agentcore/` | the runtime, its execution role, the ECR repo and CodeBuild project that build its image |

The CDK app knows no account, region or VPC: the network is passed as context, nothing is looked
up, and no account id, VPC id or ARN is committed. It creates no NAT gateway or VPC. Flash
analyzer tasks run in the subnets you pass, with a public IP.

## Prerequisites

- An AWS account and a profile for it. Everything below assumes
  `export AWS_PROFILE=personal AWS_REGION=us-east-1 AWS_DEFAULT_REGION=us-east-1`.
- Node.js 20+ (22 or 24 recommended), Python 3.12, Docker with `buildx`, the AWS CLI. The CDK CLI
  and the AgentCore CLI run through `npx`; nothing is installed globally.
- Bedrock model access to Amazon Nova Pro (`us.amazon.nova-pro-v1:0`) in `us-east-1`.
- A monthly cost budget with an email alert (about $25) in the Billing console. Idle cost is close
  to zero, but a runaway job is not.
- One-time CloudWatch Transaction Search, so that the runtime's traces are searchable:

  ```sh
  ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
  aws logs put-resource-policy --policy-name TransactionSearchXRayAccess --policy-document "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [{
      \"Sid\": \"TransactionSearchXRayAccess\", \"Effect\": \"Allow\",
      \"Principal\": {\"Service\": \"xray.amazonaws.com\"}, \"Action\": \"logs:PutLogEvents\",
      \"Resource\": [\"arn:aws:logs:$AWS_REGION:$ACCOUNT_ID:log-group:aws/spans:*\",
                     \"arn:aws:logs:$AWS_REGION:$ACCOUNT_ID:log-group:/aws/application-signals/data:*\"],
      \"Condition\": {\"ArnLike\": {\"aws:SourceArn\": \"arn:aws:xray:$AWS_REGION:$ACCOUNT_ID:*\"},
                      \"StringEquals\": {\"aws:SourceAccount\": \"$ACCOUNT_ID\"}}}]}"
  aws xray update-trace-segment-destination --destination CloudWatchLogs
  ```

## Deploy

Run from `pipeline/infra` unless a step says otherwise.

```sh
CDK="npx --yes aws-cdk@2.1146.1"
python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt
```

**1. Bootstrap** (once per account and region; creates the `CDKToolkit` stack):

```sh
$CDK bootstrap
```

**2. The network.** Use the default VPC and its public subnets (all default subnets are public):

```sh
VPC_ID=$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)
SUBNET_IDS=$(aws ec2 describe-subnets --filters Name=vpc-id,Values=$VPC_ID Name=default-for-az,Values=true \
  --query 'Subnets[].SubnetId' --output text | tr '\t' ',')
```

**3. The stack.** `-c agent_runtime_arn` is left out for now; the runtime does not exist yet.

```sh
$CDK deploy -c vpc_id=$VPC_ID -c subnet_ids=$SUBNET_IDS --require-approval never
```

**4. The flash analyzer image.** The task definition pulls `everyseat/iris:1.1.0`, which the stack
cannot build, so push it now (from the repository root):

```sh
out() { aws cloudformation describe-stacks --stack-name EverySeat \
  --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }
IRIS_REPO=$(out IrisRepositoryUri)
aws ecr get-login-password | docker login --username AWS --password-stdin "${IRIS_REPO%%/*}"
docker buildx build --platform linux/amd64 --provenance=false --sbom=false \
  -t "$IRIS_REPO:1.1.0" --push pipeline/iris
```

**5. The runtime.** The AgentCore CLI builds the arm64 image in CodeBuild from `pipeline/` (using
`pipeline/agent.Dockerfile`), creates the runtime and attaches `agentcore/app/analyzer/policy.json`
to its role. It writes the account and region into `agentcore/aws-targets.json`, which is ignored
by git.

```sh
cd agentcore/agentcore/cdk && npm ci --no-audit --no-fund && cd ../..
npx --yes @aws/agentcore@1.0.0 deploy
cd ..
```

**6. Connect the trigger to the runtime.** Read the runtime's ARN and redeploy the first stack with it:

```sh
RUNTIME_ARN=$(aws cloudformation list-exports \
  --query "Exports[?Name=='AgentCore-everyseat-default-analyzer-RuntimeArn'].Value" --output text)
$CDK deploy -c vpc_id=$VPC_ID -c subnet_ids=$SUBNET_IDS -c agent_runtime_arn=$RUNTIME_ARN \
  --require-approval never
```

Without the ARN the trigger still records every upload, as a `failed` status that says so.

## Verify

```sh
MEDIA=$(out MediaBucket); RESULTS=$(out ResultsBucket)
# A 90 s excerpt starting at 420 s. start and duration are seconds; model, title and iris=off are
# also read from the object's metadata.
aws s3 cp excerpt.mp4 "s3://$MEDIA/incoming/excerpt.mp4" --metadata start=420,duration=90
```

1. The trigger ran: `aws logs tail "$(out TriggerLogGroup)" --since 10m` ends with
   `job <job>: accepted`. Find the job id with `aws s3 ls s3://$RESULTS/jobs/`.
2. Progress: `aws s3 cp s3://$RESULTS/jobs/$JOB/status.json -` goes `queued`, `running` (the
   `stage` field names the step) and `succeeded`, or `failed` with an `error`. A 90 s excerpt takes
   a few minutes.
3. Result: on `succeeded`, `outputs` names the `.sensevtt`, `.recipe.json` and `.run.json` keys
   under `jobs/$JOB/`; `cues` and `usage` (tokens and cost) are filled in.
   `aws s3 cp s3://$RESULTS/jobs/$JOB/ ./result --recursive` fetches them.
4. Flash analyzer: `aws logs tail "$(out IrisLogGroup)" --since 30m` shows the Fargate task's
   download, analysis and upload.
5. Traces: `npx --yes @aws/agentcore@1.0.0 traces runtime list --name analyzer --since 1h` (run
   from `agentcore/`), or CloudWatch → GenAI Observability. Each job is one trace with an
   `everyseat.job` span around the agent's model and tool spans; the spans are flushed at the end
   of every job, so a trace is complete when the status turns `succeeded` or `failed`.
6. Runtime logs: `npx --yes @aws/agentcore@1.0.0 logs runtime --name analyzer --since 30m`.

## Tear down

Everything the app creates is removed; the buckets are emptied first.

```sh
aws cloudformation delete-stack --stack-name AgentCore-everyseat-default
aws cloudformation wait stack-delete-complete --stack-name AgentCore-everyseat-default
$CDK destroy -c vpc_id=$VPC_ID -c subnet_ids=$SUBNET_IDS --force
```

Then remove what outlives the stacks:

```sh
aws logs describe-log-groups --query "logGroups[?contains(logGroupName, 'everyseat') || contains(logGroupName, 'AgentCore-everyseat')].logGroupName" --output text
# delete each with: aws logs delete-log-group --log-group-name <name>
```

The container-build function of the AgentCore stack keeps a log group (retention 731 days), and the
service creates `/aws/bedrock-agentcore/runtimes/...` log groups for the runtime. The `CDKToolkit`
stack from bootstrapping is shared with any other CDK app; it holds only small assets. To remove it,
empty its staging bucket and ECR repository first, then delete the stack.

## Billable resources

List prices for us-east-1, rounded; check the AWS pricing pages before relying on them. "Idle" is
what it costs with nothing uploaded.

| Resource | Created by | Idle | When it runs |
|----------|-----------|------|--------------|
| S3 media bucket | `EverySeat` | $0 empty; $0.023 per GB-month | Films you upload, until you delete them |
| S3 results bucket | `EverySeat` | $0 empty | A few KB per job; `work/` (flash analyzer staging) expires after 1 day |
| ECR repository `everyseat/iris` | `EverySeat` | about $0.01 to $0.04 per month ($0.10 per GB-month; the image is a few hundred MB; at most 3 images kept) | Pushes and pulls are free inside the region |
| ECR repository `everyseat/agent` | `EverySeat` | $0 (empty; reserved for pushing the runtime image by hand, the CLI does not use it) | Same as above |
| ECS cluster `everyseat` | `EverySeat` | $0 | No charge for the cluster itself |
| Fargate x86 task (2 vCPU, 4 GB, 50 GiB disk) | the runtime, per run | $0 | about $0.10 per task-hour plus $0.005 per hour for the public IPv4 address; a 90 s excerpt is under $0.01 |
| Lambda "Trigger" (arm64, 128 MB) | `EverySeat` | $0 | Well inside the free tier for a few uploads |
| EventBridge rule | `EverySeat` | $0 | Events from AWS services on the default bus are free |
| CloudWatch log groups (trigger, flash analyzer; 1 week retention) | `EverySeat` | $0 | $0.50 per GB ingested |
| IAM roles, security group, task definition | `EverySeat` | $0 | No charge |
| AgentCore Runtime `everyseat_default_analyzer` | `AgentCore-everyseat-default` | $0 with no session | Billed per second for the CPU used and memory held from session start to end; one session per job, which lasts the job plus 60 s idle. CPU is not billed while the agent waits for the model or Fargate |
| CodeBuild project (arm64, small) | `AgentCore-everyseat-default` | $0 | A few cents per image build (a few minutes); builds run on `agentcore deploy` |
| ECR repository `everyseat/default/analyzer` | `AgentCore-everyseat-default` | about $0.03 per month | Storage of the runtime image (about 290 MB uncompressed) |
| KMS key encrypting that repository | `AgentCore-everyseat-default` | **$1.00 per month** while the stack exists (the only fixed cost) | $0.03 per 10,000 requests |
| CloudWatch log groups for the runtime and the image builder | the service and `AgentCore-everyseat-default` | $0 | $0.50 per GB ingested; the builder's group is kept after teardown |
| CloudWatch Transaction Search (spans) | account setting | $0 | Span ingestion at $0.50 per GB; a job emits a few hundred KB |
| Amazon Nova Pro on Bedrock | the runtime | $0 | $0.0008 per 1K input and $0.0032 per 1K output tokens; $0.03 to $0.10 per 90 s excerpt (measured locally) |
| `CDKToolkit` stack: staging bucket, asset ECR repository, roles | `cdk bootstrap` | cents per month | Holds the Lambda package and the runtime's build context |
| Default VPC, its subnets and internet gateway | already in the account | $0 | No NAT gateway is created (about $32 per month each); public IPv4 addresses are billed only while a task runs |

Idle total: about **$1 per month** (the KMS key), plus cents of storage.

## Notes and limits

- **Object names.** Use simple names under `incoming/` (letters, digits, `.`, `-`, `_`). The trigger
  takes the key from the event as is and does not decode `+` or `%` escapes.
- **Excerpts.** The flash analyzer receives the proxy through presigned URLs signed when the task
  starts, using the runtime role's temporary credentials; they must outlive the run. That holds for
  excerpts of a few minutes. The task has 50 GiB of scratch disk, which bounds the length of a
  film (proxy plus analyzer output).
- **Retries.** The upload rule retries delivery twice and the function twice more on a runtime
  error; a job is identified by the object's bucket, key and ETag, so a retry reuses its session
  and a running job is not started twice.
- **Region.** The roles and the runtime policy are written for `us-east-1`.
- **Entrypoint in `agentcore.json`.** The CLI schema requires `entrypoint`, but the container is
  started by the `CMD` in `pipeline/agent.Dockerfile`, which runs `everyseat.cloud.app` under
  `opentelemetry-instrument`.

## Checks that need no credentials

```sh
# the stack, with placeholder network ids
env -u AWS_PROFILE AWS_CONFIG_FILE=/dev/null AWS_SHARED_CREDENTIALS_FILE=/dev/null \
  $CDK synth -c vpc_id=vpc-00000000 -c subnet_ids=subnet-0000000a,subnet-0000000b --quiet

# the images (from pipeline/)
docker buildx build --platform linux/arm64 -f agent.Dockerfile -t everyseat-agent .
docker build --platform linux/amd64 -t iris-cpp:1.1.0 iris
```

`agentcore build` synthesizes the second stack; it needs an `agentcore/aws-targets.json` with a
placeholder entry (`[{"name":"default","account":"000000000000","region":"us-east-1"}]`) and
the `npm ci` from step 5.
