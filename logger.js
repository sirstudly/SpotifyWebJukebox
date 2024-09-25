const {createLogger, format, transports} = require('winston');
require('winston-daily-rotate-file');

const defaultFormat = format.combine(
    format.timestamp(),
    format.splat(),
    format.errors({stack: true}),
    format.printf(({level, message, timestamp}) => {
        if (message.length && message[message.length - 1].stack) {
            return `${timestamp} ${level}: ${message} - ${message[message.length - 1].stack}`;
        }
        return `${timestamp} ${level}: ${message}`;
    })
);

const consoleTransport = new transports.Console();
const infoTransport = new transports.DailyRotateFile({
    filename: 'info-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    zippedArchive: false,
    frequency: '1d',
    maxFiles: '30d'
});

const infoLogger = createLogger({
    level: 'info',
    format: defaultFormat,
    transports: [
        consoleTransport,
        infoTransport
    ]
});

const errorTransport = new transports.DailyRotateFile({
    level: 'error',
    filename: 'error-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    zippedArchive: false,
    frequency: '1d',
    maxFiles: '90d'
});

const errorLogger = createLogger({
    level: 'error',
    format: defaultFormat,
    transports: [
        consoleTransport,
        infoTransport,
        errorTransport
    ]
});

module.exports = {
    'infoLogger': infoLogger,
    'errorlogger': errorLogger
};