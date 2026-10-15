/** Operational error that maps cleanly to an HTTP response. */
class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
const badRequest = (m, d) => new AppError(400, 'BAD_REQUEST', m, d);
const unauthorized = (m = 'Authentication required') => new AppError(401, 'UNAUTHORIZED', m);
const forbidden = (m = 'You do not have access to this resource') => new AppError(403, 'FORBIDDEN', m);
const notFound = (m = 'Resource not found') => new AppError(404, 'NOT_FOUND', m);
const conflict = (m) => new AppError(409, 'CONFLICT', m);

module.exports = { AppError, badRequest, unauthorized, forbidden, notFound, conflict };
