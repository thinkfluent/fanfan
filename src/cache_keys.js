module.exports.countKeys = (jobId) => {
    return [
        `fanfan-${jobId}-ok`,
        `fanfan-${jobId}-fail`
    ];
}

module.exports.coreKeys = (jobId) => {
    return [
        `fanfan-${jobId}-start`,
        `fanfan-${jobId}-tasks`,
        `fanfan-${jobId}-request`,
    ];
}