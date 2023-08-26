const appConfig = require('../config.js');
const logger = require('../logger.js');
const redisClient = require('../redis.js');
const pubsub = require('../pubsub.js');
const itemStatus = require("../status.js");
const cacheKeys = require("../cache_keys.js");
const validator = require('../validate.js');
const outcomeBuilder = require('../job_outcome.js');
const timeouts = require('../timeouts.js');

module.exports = (req, res) => {
    const [attribs, taskOutcome] = pubsub.extractPubSub(req.body.message);
    // @todo performance - do we want this call when we are probably not logging?
    logger.debug({taskOutcome}, 'PS:taskOutcome');

    try {
        validator.validateTaskOutcome(taskOutcome);
    } catch (error) {
        logger.error({taskOutcome}, 'Invalid taskOutcome, ignoring');
        // Send a 200 anyway, as this is a dead end
        res.status(200).json({});
        return;
    }

    const jobId = taskOutcome.jobId;
    const taskId = taskOutcome.taskId;

    // Redis keys
    const [taskOkCountKey, taskFailCountKey] = cacheKeys.countKeys(jobId);
    const [jobStartKey, jobTasksKey, jobRequestKey, jobDoneKey] = cacheKeys.coreKeys(jobId);

    const thisTaskFailed = (itemStatus.task.SUCCEEDED !== taskOutcome.status);
    const incrTargetKey = thisTaskFailed ? taskFailCountKey : taskOkCountKey;
    redisClient.incr(incrTargetKey).then((incrResult) => {
        redisClient.sRem(jobTasksKey, [taskId]).then((sRemResult) => {
            // Cleared 1 task
            redisClient.sCard(jobTasksKey).then((sCardResult) => {
                // Tasks remaining: sCardResult
                if (sCardResult < 1) {
                    // All tasks done
                    // Check for race condition on last Task / Job completion
                    redisClient.setNX(jobDoneKey, jobDoneKey).then((setNXResult) => {
                        if (setNXResult) {
                            // We have successfully acquired the "lock" for the JobDone check
                            outcomeBuilder.runForLastTaskDone(jobId).then(() => {
                                // Cleanup (delete counts, job meta, task list, clear timeout)
                                timeouts.cancelForJob(jobId);
                                redisClient.del([taskOkCountKey, taskFailCountKey, jobStartKey, jobTasksKey, jobRequestKey, jobDoneKey]);
                                logger.info({}, `Job [${jobId}] complete. All tasks complete`);
                                res.json({jobId});
                            }).catch((error) => {
                                logger.error({}, 'Error when producing/publishing JobOutcome');
                            });
                        } else {
                            logger.debug(`JobDone race condition avoided. setNX result for done was ${setNXResult}`);
                        }
                    }).catch((error) => {
                        // @todo determine best approach here (e.g. carry out JobDone work anyway)
                        logger.warn(error, 'Failed to setNX for JobDone race condition avoidance');
                    });
                } else {
                    // Still tasks remaining
                    res.json({jobId});
                }
            }).catch((error) => {
                logger.warn(error, 'Failed to sCard (count remaining tasks)');
            });
        }).catch((error) => {
            logger.warn(error, 'Failed to sRem (clear completed task)');
        });
    }).catch((error) => {
        logger.warn(error, 'Failed to incr (task success or fail counter)')
    });
}