'use strict';

require('dotenv').config();
const { initDb } = require('./src/db');
const { startCronJobs } = require('./src/cron');
const app = require('./src/server');

const PORT = process.env.PORT || 3000;

initDb();
startCronJobs();

app.listen(PORT, () => {
  console.log(`[mgx-cs-agent] Running on port ${PORT}`);
  console.log(`[mgx-cs-agent] Support: ${process.env.SUPPORT_EMAIL}`);
  console.log(`[mgx-cs-agent] Escalation: ${process.env.ESCALATION_EMAIL}`);
  console.log(`[mgx-cs-agent] Fulfillment: ${process.env.FULFILLMENT_EMAIL}`);
});
