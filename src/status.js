module.exports.task = {
    PENDING: 'PENDING',
    RUNNING: 'RUNNING',
    SUCCEEDED: 'SUCCEEDED',
    TIMEOUT: 'TIMEOUT',
    FAILED: 'FAILED'
}

module.exports.job = {
    PENDING: 'PENDING',
    SCHEDULED: 'SCHEDULED',
    RUNNING: 'RUNNING',
    SUCCEEDED: 'SUCCEEDED',
    FAILED: 'FAILED' // @todo Do we want "partial"?
}