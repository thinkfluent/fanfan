module.exports = require('rc')('fanfan', {
    app_mode: process.env.APP_MODE || 'prod',
    port: process.env.PORT || 8080,
    redis_host: process.env.REDIS_HOST || '127.0.0.1',
    redis_port: process.env.REDIS_PORT || '6379',
    pubsub_topic_tasks: 'fanfan-task',
    pubsub_topic_job_done: 'fanfan-job-done',
    gcp_project: process.env.GCP_PROJECT || 'get-fanfan',
    log_level: process.env.LOG_LEVEL || 'warn',
    log_http: process.env.LOG_HTTP || false,
    nx_done_ttl: parseInt(process.env.NX_DONE_KEY_TTL || 120),
});