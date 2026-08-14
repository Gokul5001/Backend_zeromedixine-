// utils/scheduleRunner.js

const WhatsAppScheduleLog = require("../Models/WhatsAppScheduleLog");
const { sendTemplateMessage } = require("./superfonenew.js");

const BATCH_SIZE = 5;
const BATCH_INTERVAL_MS = 10_000; // 10 sec between batches
const CONTACT_INTERVAL_MS = 1500; // 1.5 sec between contacts
const RUNNER_POLL_MS = 30_000; // check every 30 sec

// ─────────────────────────────────────────────
// Sleep helper
// ─────────────────────────────────────────────
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────
// Execute one scheduled campaign
// ─────────────────────────────────────────────
async function executeSchedule(doc) {
  try {
    console.log(
      `[Runner] Executing schedule ${doc._id} — ${doc.totalContacts} contacts`
    );

    // mark running
    doc.status = "running";
    doc.executedAt = new Date();
    await doc.save();

    // split contacts into batches
    const batches = [];

    for (let i = 0; i < doc.contacts.length; i += BATCH_SIZE) {
      batches.push(doc.contacts.slice(i, i + BATCH_SIZE));
    }

    let sentCount = 0;
    let failedCount = 0;

    // ─────────────────────────────────────────────
    // Process each batch
    // ─────────────────────────────────────────────
    for (let bi = 0; bi < batches.length; bi++) {
      const batch = batches[bi];

      console.log(
        `[Runner] Batch ${bi + 1}/${batches.length} — ${batch.length} contacts`
      );

      // ─────────────────────────────────────────────
      // SEND CONTACTS ONE BY ONE
      // ─────────────────────────────────────────────
      for (let idx = 0; idx < batch.length; idx++) {
        const contact = batch[idx];
        const globalIdx = bi * BATCH_SIZE + idx;

        try {
          await sendTemplateMessage({
            to: contact.phone,
            templateName: doc.templateName,
            language: doc.language || "en",

            // hi_followup has NO params
            params: [],

            ...(doc.imageUrl
              ? { headerImage: doc.imageUrl }
              : {}),
          });

          // success
          doc.contacts[globalIdx].status = "sent";
          doc.contacts[globalIdx].error = null;

          sentCount++;

          console.log(`✅ Sent to ${contact.phone}`);

        } catch (err) {
          // failed
          doc.contacts[globalIdx].status = "failed";
          doc.contacts[globalIdx].error =
            err.message || String(err);

          failedCount++;

          console.error(
            `❌ Failed ${contact.phone}:`,
            err.message
          );
        }

        // save after every contact
        doc.sentCount = sentCount;
        doc.failedCount = failedCount;

        await doc.save();

        // small delay between contacts
        if (idx < batch.length - 1) {
          console.log(
            `[Runner] Waiting ${CONTACT_INTERVAL_MS / 1000}s before next contact...`
          );

          await sleep(CONTACT_INTERVAL_MS);
        }
      }

      console.log(
        `[Runner] Progress — sent: ${sentCount}, failed: ${failedCount}`
      );

      // ─────────────────────────────────────────────
      // WAIT BEFORE NEXT BATCH
      // ─────────────────────────────────────────────
      if (bi < batches.length - 1) {
        console.log(
          `[Runner] Waiting ${BATCH_INTERVAL_MS / 1000}s before next batch...`
        );

        await sleep(BATCH_INTERVAL_MS);
      }
    }

    // ─────────────────────────────────────────────
    // Final status
    // ─────────────────────────────────────────────
    doc.status =
      failedCount === doc.totalContacts
        ? "failed"
        : "sent";

    await doc.save();

    console.log(
      `[Runner] Done ${doc._id} — sent: ${sentCount}, failed: ${failedCount}`
    );

  } catch (err) {
    console.error(
      `[Runner] Fatal execution error for ${doc._id}:`,
      err
    );

    doc.status = "failed";
    await doc.save();
  }
}

// ─────────────────────────────────────────────
// Poll MongoDB for due schedules
// ─────────────────────────────────────────────
function startScheduleRunner() {
  console.log(
    `🕒 WhatsApp Schedule Runner started (${RUNNER_POLL_MS / 1000}s polling)`
  );

  setInterval(async () => {
    try {
      const now = new Date();

      // find pending schedules due now
      const dueSchedules = await WhatsAppScheduleLog.find({
        status: "pending",
        scheduledAt: { $lte: now },
      });

      if (dueSchedules.length > 0) {
        console.log(
          `[Runner] Found ${dueSchedules.length} due schedules`
        );
      }

      // execute schedules one by one
      for (const doc of dueSchedules) {
        await executeSchedule(doc);
      }

    } catch (err) {
      console.error(
        "[Runner] Polling error:",
        err 
      );
    }
  }, RUNNER_POLL_MS);
}

module.exports = {
  startScheduleRunner,
};