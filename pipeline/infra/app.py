#!/usr/bin/env python3
import aws_cdk as cdk
from everyseat_infra.config import Settings
from everyseat_infra.stack import EverySeatStack

app = cdk.App()
# No env: the stack is account- and region-agnostic and no lookup is ever made.
EverySeatStack(app, "EverySeat", settings=Settings.from_context(app.node))
cdk.Tags.of(app).add("project", "everyseat")
app.synth()
