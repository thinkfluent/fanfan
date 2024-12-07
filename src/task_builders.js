const { v4: uuidv4 } = require('uuid');

module.exports.hasPerTaskPayloadField = false;

module.exports.perTaskPayloadField = '';

module.exports.factory = (data) => {
    if (data?.fanout?.tasks) {
        this.hasPerTaskPayloadField = false;
        return simpleTasksBuilder;
    }
    if (data?.fanout?.foreach?.as) {
        this.hasPerTaskPayloadField = true;
        this.perTaskPayloadField = data.fanout.foreach.as;
        return forEachBuilder;
    }
    if (data?.fanout?.range?.as) {
        this.hasPerTaskPayloadField = true;
        this.perTaskPayloadField = data.fanout.range.as;
        return rangeBuilder;
    }
    throw new Error('Could not resolve Task builder');
}

const simpleTasksBuilder = (jobId, data) => {
    const tasks = new Map();
    const taskCount = parseInt(data.fanout.tasks || 1);
    for (let taskNum = 0; taskNum < taskCount; taskNum++) {
        const taskId = uuidv4();
        tasks.set(taskId, null);
    }
    return tasks;
}

const forEachBuilder = (jobId, data) => {
    const tasks = new Map();
    data.fanout.foreach.items.forEach((item) => {
        const taskId = uuidv4();
        tasks.set(taskId, item);
    });
    return tasks;
}

const rangeBuilder = (jobId, data) => {
    const tasks = new Map();
    for (
        let index = data.fanout.range.start;
        index <= data.fanout.range.stop;
        index = index + data.fanout.range.step
    ) {
        const taskId = uuidv4();
        tasks.set(taskId, index);
    }
    return tasks;
}