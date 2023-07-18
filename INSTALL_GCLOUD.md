# FanFan - Google Cloud Installation

This guide works through manually deploying FanFan to a Google Cloud project using the `gcloud` tool.

We'll set up the FanFan Cloud Run service as private, protected by IAM with no public access - then grants permissions to the Pub/Sub push subscriptions to make API calls.

It uses the demo application target (Docker image, target URLs) - you will need to review these for your own application.

The demo application service is deployed as public, so we can easily run tests & demo API calls. You should review this and change the authentication to suit your application.

> ***TODO** - Terraform, Scripted, Cloud Build equivalents*

## Requirements

Before you get started, please ensure you have to hand
- Google Cloud project ID (with billing enabled)
  - e.g. `get-fanfan`.
  - Commands below use `PROJECT_ID` as a placeholder
- Target Region & Zone
  - This is where we will install services, like the Redis instance and Cloud Run services
  - e.g. `europe-west1`, `europe-west1-d`
  - Commands below use `REGION` and `ZONE` as a placeholder

## Deploying to Google Cloud with `gcloud`

### Enable APIs

Enable required services (Memorystore/Redis, Cloud Run, VPC Access)
```bash
gcloud services enable \
  redis.googleapis.com \
  vpcaccess.googleapis.com \
  run.googleapis.com \
  --project=PROJECT_ID
```

### Service Accounts

Let's create dedicated Service Accounts for the FanFan service
```bash
gcloud iam service-accounts create fanfan \
    --description="FanFan Service Account" \
    --display-name="FanFan" \
    --project=PROJECT_ID \
    --format="value(email)"
```
And a Service Account for the FanFan Pub/Sub Push Subscriptions
```bash
gcloud iam service-accounts create fanfan-invoker \
    --description="FanFan Invoker Account" \
    --display-name="FanFan Invoker" \
    --project=PROJECT_ID \
    --format="value(email)"
```

### Infrastructure, Shared Components
Redis
```bash
gcloud redis instances create fanfan \
  --display-name="FanFan" \
  --region=REGION \
  --zone=ZONE \
  --tier=basic \
  --size=1 \
  --project=PROJECT_ID \
  --network=default \
  --quiet
```
Get the IP of the newly created redis host
```bash
gcloud redis instances describe fanfan1 --region=REGION --project=PROJECT_ID --format="value(host)"
```

VPC Connector. I've used the recommended subnet here for new projects. But please verify this for your setup.
```bash
gcloud compute networks vpc-access connectors create fanfan-connector \
  --network default \
  --region REGION \
  --range 10.8.0.0/28 \
  --project=PROJECT_ID
```


Pub/Sub Topics
```bash
gcloud pubsub topics create \
  fanfan-job-request \
  fanfan-task \
  fanfan-task-done \
  fanfan-task-dead-letter \
  fanfan-job-done \
  --project=PROJECT_ID
```

### FanFan Service & Push Subscriptions

Cloud Run service (Replace `REDIS_IP_ADDRESS` with the IP address of the Redis instance).

As noted above, this service is protected by IAM rules and not publicly accessible.
```bash
gcloud run deploy fanfan \
  --image="fluentthinking/fanfan:latest" \
  --no-allow-unauthenticated \
  --platform managed \
  --project=PROJECT_ID \
  --region=REGION \
  --vpc-connector=fanfan-connector \
  --max-instances=10 \
  --concurrency=250 \
  --memory=256Mi \
  --cpu=1 \
  --set-env-vars=REDIS_HOST=REDIS_IP_ADDRESS
```
Get the URL of the new FanFan service. This will be something like `https://fanfan-5kd4odq1gh-ew.a.run.app`.
```bash
gcloud run services describe fanfan --project=PROJECT_ID --format="value(status.address.url)"
```

Grant "Cloud Run Invoke" permissions to the Pub/Sub service account
```bash
gcloud run services add-iam-policy-binding fanfan \
   --member=serviceAccount:fanfan-invoker@PROJECT_ID.iam.gserviceaccount.com \
   --role=roles/run.invoker \
   --project=PROJECT_ID 
```
```bash
gcloud projects add-iam-policy-binding PROJECT_ID \
  --member=serviceAccount:fanfan-invoker@PROJECT_ID.iam.gserviceaccount.com \
  --role=roles/run.invoker \
  --project=PROJECT_ID 
```

Subscriptions Targeting FanFan (swap out `FANFAN_HOST` with your service URL)
```bash
gcloud pubsub subscriptions create fanfan-job-request-push \
  --topic fanfan-job-request \
  --ack-deadline=600 \
  --push-endpoint=FANFAN_HOST/job/fan-out \
  --push-auth-service-account=fanfan-invoker@PROJECT_ID.iam.gserviceaccount.com \
  --project=PROJECT_ID
```
```bash
gcloud pubsub subscriptions create fanfan-task-done-push \
  --topic fanfan-task-done \
  --ack-deadline=600 \
  --push-endpoint=FANFAN_HOST/task/done \
  --push-auth-service-account=fanfan-invoker@PROJECT_ID.iam.gserviceaccount.com \
  --project=PROJECT_ID
```
```bash
gcloud pubsub subscriptions create fanfan-task-dead-push \
  --topic fanfan-task-dead-letter \
  --ack-deadline=600 \
  --push-endpoint=FANFAN_HOST/task/dead \
  --push-auth-service-account=fanfan-invoker@PROJECT_ID.iam.gserviceaccount.com \
  --project=PROJECT_ID
```

### Application Service & Push Subscriptions

Demo Application Cloud Run service
```bash
gcloud run deploy fanfan-myapp \
  --image="fluentthinking/fanfan-demo-php:latest" \
  --allow-unauthenticated \
  --platform managed \
  --project=PROJECT_ID \
  --concurrency=50 \
  --memory=512Mi \
  --cpu=1 \
  --region=REGION
```
Get the URL of the application service. This will be something like `https://fanfan-myapp-5kd4odq1gh-ew.a.run.app`.
```bash
gcloud run services describe fanfan-myapp --project=PROJECT_ID --format="value(status.address.url)"
```

Main task subscription, with Dead-Letter topic and our final "job done" subscription (swap out `APPLICATION_HOST` with your service URL)
```bash
gcloud pubsub subscriptions create fanfan-task-push \
  --topic fanfan-task \
  --ack-deadline=600 \
  --push-endpoint=APPLICATION_HOST/task/run \
  --max-delivery-attempts=10 \
  --dead-letter-topic=fanfan-task-dead-letter \
  --project=PROJECT_ID
```
```bash
gcloud pubsub subscriptions create fanfan-job-done-push \
  --topic fanfan-job-done \
  --ack-deadline=600 \
  --push-endpoint=APPLICATION_HOST/job/done \
  --project=PROJECT_ID
```