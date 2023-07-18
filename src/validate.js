
module.exports.validateJobRequest = (data) => {
    mustBeObject(data);
    if ('string' !== typeof data.action) {
        throw new Error('No/invalid action specified');
    }
    if ('object' !== typeof data.fanout) {
        throw new Error('No/invalid fanout spec provided');
    }
    if ('object' === typeof data.fanout.foreach) {
        if ('string' !== typeof data.fanout.foreach.as ||
            !Array.isArray(data.fanout.foreach.items)
        ) {
            throw new Error('Invalid fanout/foreach spec provided');
        }
    } else if ('object' === typeof data.fanout.range) {
        if ('string' !== typeof data.fanout.range.as ||
            'number' !== typeof data.fanout.range.start ||
            'number' !== typeof data.fanout.range.stop ||
            'number' !== typeof data.fanout.range.step
        ) {
            throw new Error('Invalid fanout/range spec provided');
        }
    } else if ('number' === typeof data.fanout.tasks) {
        // Ace!
    } else {
        throw new Error('Invalid fanout spec provided');
    }
    optionalPayloadObject(data);
}

module.exports.validateTaskOutcome = (data) => {
    mustBeObject(data);
    mustHaveJobAndTaskIds(data);
    if ('string' !== typeof data.status) {
        throw new Error('No/invalid status specified');
    }
    optionalPayloadObject(data);
}

module.exports.validateTask = (data) => {
    mustBeObject(data);
    mustHaveJobAndTaskIds(data);
    optionalPayloadObject(data);
}

const mustBeObject = (data) => {
    if ('object' !== typeof data) {
        throw new Error('Payload not an object');
    }
}

const mustHaveJobAndTaskIds = (data) => {
    if ('string' !== typeof data.jobId) {
        throw new Error('No/invalid jobId specified');
    }
    if ('string' !== typeof data.taskId) {
        throw new Error('No/invalid taskId specified');
    }
}

const optionalPayloadObject = (data) => {
    if (data.payload) {
        if ('object' !== typeof data.payload || Array.isArray(data.payload)) {
            throw new Error('Supplied payload not an object');
        }
    }
}