const timestamp = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

const format = (level, msg, data) => {
  const base = `[${timestamp()}] ${level}: ${msg}`;
  return data ? `${base} ${JSON.stringify(data)}` : base;
};

export const logger = {
  info: (msg, data) => console.log(format('INFO', msg, data)),
  warn: (msg, data) => console.warn(format('WARN', msg, data)),
  error: (msg, data) => console.error(format('ERROR', msg, data)),
};
