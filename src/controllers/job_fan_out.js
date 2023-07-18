const appConfig = require('../config.js');
const logger = require('../logger.js');
const redisClient = require('../redis.js');
const pubsub = require('../pubsub.js');
const taskBuilders = require('../task_builders.js');
const {v4: uuidv4} = require("uuid");
const cacheKeys = require("../cache_keys.js");
const validator = require('../validate.js');

module.exports = (req, res) => {
    const startTime = Date.now();
    const [attribs, jobRequest] = pubsub.extractPubSub(req.body.message);
    logger.debug({jobRequest}, 'PS:jobRequest');

    const logSendStatus = (error, message, status) => {
        logger.error(error);
        res.status(status).json({error: message, detail: error});
    }

    try {
        validator.validateJobRequest(jobRequest);
    } catch (error) {
        logger.error({jobRequest}, 'Invalid jobRequest');
        // Send 200 anyway for Pub/Sub, as we're at a dead-end.
        logSendStatus(error, 'InvalidSpec', 200);
        return;
    }

    // OK, new Job, start building tasks
    const taskBuilder = taskBuilders.factory(jobRequest);
    const jobId = uuidv4();
    logger.info(`Creating new Job: ${jobId}`);

    // Prepare Redis Keys
    const [jobStartKey, jobTasksKey, jobRequestKey] = cacheKeys.coreKeys(jobId);

    // Promises which need to resolve
    const mustPersist = [];
    mustPersist.push(redisClient.set(jobStartKey, startTime));
    mustPersist.push(redisClient.set(jobRequestKey, JSON.stringify(jobRequest)));

    // Create the Tasks and Task SET in Redis
    const tasks = taskBuilder(jobId, jobRequest);
    mustPersist.push(redisClient.sAdd(jobTasksKey, Array.from(tasks.keys())));

    // Default payload & payload builder
    const defaultPayload = jobRequest.payload || {};
    let buildTaskPayload = (perTaskData) => defaultPayload;
    if (taskBuilders.hasPerTaskPayloadField) {
        buildTaskPayload = (perTaskData) => {
            defaultPayload[taskBuilders.perTaskPayloadField] = perTaskData;
            return defaultPayload;
        }
    }

    // Prepare for publication
    const taskPubSubAttributes = jobRequest.taskAttributes || {};
    const taskAction = jobRequest.action || 'default';
    const targetTopicName = jobRequest.taskTopic || appConfig.pubsub_topic_tasks;
    // @todo handle missing custom topics
    const taskTopic = pubsub.getTopic(targetTopicName);
    Promise.all(mustPersist).then(() => {
        const publishPromises = [];
        tasks.forEach((taskData, taskId) => {
            publishPromises.push(
                // Publish to PubSub
                taskTopic.publishMessage({
                    data: Buffer.from(JSON.stringify({
                        jobId: jobId,
                        taskId: taskId,
                        action: taskAction,
                        payload: buildTaskPayload(taskData)
                    })),
                    attributes: taskPubSubAttributes
                })
            );
        });

        // Once all messages are published
        Promise.all(publishPromises).then((messageIds) => {
            logger.info({
                jobId,
                tasks: tasks.size,
                tookMs: Date.now() - startTime
            }, 'Fan-out complete');
            res.json({jobId: jobId, tasks: tasks.length, messages: messageIds.length});
        }).catch((error) => {
            // Should not retry, send 200
            logSendStatus(error, 'partialPublish', 200);
        });
    }).catch((error) => {
        // We want to retry, send 500
        logSendStatus(error, 'didNotPublish', 500);
    });
}

