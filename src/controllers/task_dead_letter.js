const logger = require('../logger.js');
const pubsub = require("../pubsub");
const itemStatus = require("../status.js");
const taskDoneController = require("./task_done.js");
const validator = require("../validate");

/**
 * This task has bounced back after repeated failures.
 *
 * Treat it as failed (via the taskDoneController)
 */
module.exports = (req, res) => {
    const [attribs, task] = pubsub.extractPubSub(req.body.message);
    logger.warn({task}, 'PS:Dead letter task');

    try {
        validator.validateTask(task);
    } catch (error) {
        logger.error({task}, 'Invalid dead-letter task, ignoring');
        // Send a 200 anyway, as this is a dead end
        res.status(200).json({});
        return;
    }

    // Fake the Pub/Sub message within the request
    // and pass to the "Task Done" controller
    req.body.message = {
        data: Buffer.from(JSON.stringify({
            jobId: task.jobId,
            taskId: task.taskId,
            status: itemStatus.task.FAILED
        })).toString('base64')
    };
    return taskDoneController(req, res);
}
