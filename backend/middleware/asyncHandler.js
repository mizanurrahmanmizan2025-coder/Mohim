/** Forwards async errors to Express' error handler (Express 4 doesn't do this itself). */
module.exports = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
