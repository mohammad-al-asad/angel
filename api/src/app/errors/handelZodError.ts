import { ZodError, ZodIssue } from "zod";
import httpStatus from "http-status";
import { TErrorSources, TGenericErrorResponse } from "../interface/error";

const handelZodError = (err: ZodError): TGenericErrorResponse => {
  const errorSources: TErrorSources = err.issues.map((issue: ZodIssue) => {
    const lastPath = issue.path[issue.path.length - 1];

    return {
      path:
        typeof lastPath === "string" || typeof lastPath === "number"
          ? lastPath
          : String(lastPath),
      message: issue.message,
    };
  });

  // Surface the actual field errors (e.g. "Invalid email format") instead of a generic
  // message, so clients that only display `message` still show something useful.
  const message =
    [...new Set(errorSources.map((source) => source.message).filter(Boolean))].join(", ") ||
    "Validation error";

  return {
    statusCode: httpStatus.BAD_REQUEST,
    message,
    errorSources,
  };
};

export default handelZodError;
