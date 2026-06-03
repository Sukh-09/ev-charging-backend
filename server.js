/**
 * server.js — EV Charging Station Telemetry Backend
 *
 * Optimized for cross-region deployment:
 *   - App hosted on Render (US region, free tier)
 *   - MongoDB Atlas hosted on AWS ap-southeast-2 (Sydney)
 *
 * Key design decisions:
 *   - Uses direct shard connection string (no SRV) to bypass Render's
 *     broken querySrv DNS resolution on free tier.
 *   - Extended serverSelectionTimeoutMS / socketTimeoutMS to accommodate
 *     the cross-Pacific round-trip latency.
 *   - No deprecated Mongoose options (useNewUrlParser, useUnifiedTopology
 *     were removed in Mongoose 6+).
 */

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();

// ─────────────────────────────────────────────
// MIDDLEWARE
// ─────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ─────────────────────────────────────────────
// DATABASE CONNECTION
//
// Direct shard routing bypasses Render's SRV DNS lookup failure.
// serverSelectionTimeoutMS: 15 s — time allowed to find a primary
//   replica before throwing (cross-Pacific DNS + TCP handshake needs room).
// socketTimeoutMS: 45 s — max idle time on an open socket before
//   Mongoose closes it, preventing silent hung connections.
// ─────────────────────────────────────────────
const MONGO_URI =
  'mongodb://singhsukhpinder827_db_user:GqV9ViLI0uZwXEt7@' +
  'ac-mvh7i5b-shard-00-00.3ihlget.mongodb.net:27017,' +
  'ac-mvh7i5b-shard-00-01.3ihlget.mongodb.net:27017,' +
  'ac-mvh7i5b-shard-00-02.3ihlget.mongodb.net:27017' +
  '/test?ssl=true&replicaSet=atlas-shard-0&authSource=admin' +
  '&retryWrites=true&w=majority';

mongoose
  .connect(MONGO_URI, {
    serverSelectionTimeoutMS: 15000, // 15 s — cross-region handshake budget
    socketTimeoutMS: 45000,          // 45 s — max idle socket lifetime
  })
  .then(() => {
    console.log('[DB] ✅ Connected to MongoDB Atlas (ap-southeast-2 / Sydney)');
  })
  .catch((err) => {
    console.error('[DB] ❌ Connection failed:', err.message);
    // Do NOT call process.exit() — Render will restart the dyno;
    // letting the process live allows the health-check route to still
    // report readyState = 0 (disconnected) rather than a hard crash.
  });

// Surface reconnection events for visibility in Render logs
mongoose.connection.on('disconnected', () =>
  console.warn('[DB] ⚠️  Mongoose disconnected — will retry automatically')
);
mongoose.connection.on('reconnected', () =>
  console.log('[DB] 🔄 Mongoose reconnected')
);

// ─────────────────────────────────────────────
// SCHEMA & MODEL
// ─────────────────────────────────────────────
const TelemetrySchema = new mongoose.Schema({
  station_id:    { type: String, required: true },
  voltage:       { type: Number, required: true },
  battery_level: { type: Number, required: true },
  status:        { type: String, required: true },
  timestamp:     { type: Date,   default: Date.now },
});

// Index on station_id + timestamp so dashboard queries stay fast even
// as the collection grows — critical when every read crosses the Pacific.
TelemetrySchema.index({ station_id: 1, timestamp: -1 });

const Telemetry = mongoose.model('Telemetry', TelemetrySchema);

// ─────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────

/**
 * GET /
 * Health / wake check.
 *
 * readyState values:
 *   0 = disconnected
 *   1 = connected   ✅
 *   2 = connecting
 *   3 = disconnecting
 */
app.get('/', (req, res) => {
  const state = mongoose.connection.readyState;
  const stateLabel = ['disconnected', 'connected', 'connecting', 'disconnecting'][state] ?? 'unknown';

  res.json({
    service:    'EV Charging Telemetry API',
    status:     'awake',
    db_state:   state,
    db_label:   stateLabel,
    db_region:  'AWS ap-southeast-2 (Sydney)',
    timestamp:  new Date().toISOString(),
  });
});

/**
 * POST /telemetry
 * Ingest a telemetry payload from the simulation pipeline.
 *
 * Expected body:
 *   { station_id, voltage, battery_level, status, timestamp? }
 */
app.post('/telemetry', async (req, res) => {
  try {
    const { station_id, voltage, battery_level, status, timestamp } = req.body;

    const record = new Telemetry({
      station_id,
      voltage,
      battery_level,
      status,
      ...(timestamp && { timestamp }),
    });

    const saved = await record.save();

    return res.status(201).json({
      message: 'Telemetry record saved successfully.',
      id:      saved._id,
    });
  } catch (err) {
    console.error('[POST /telemetry] Error:', err.message);
    return res.status(500).json({
      error:   'Failed to save telemetry record.',
      details: err.message,
    });
  }
});

/**
 * GET /telemetry
 * Dashboard feed — returns the latest entry per tracked station
 * plus a recent global log tail.
 *
 * Query params (all optional):
 *   ?station_id=STN-001   — filter to one station
 *   ?limit=50             — override default log tail size (max 200)
 *
 * Architecture note:
 *   We fetch the latest single document per station via targeted
 *   queries (indexed on station_id + timestamp) rather than a full
 *   collection scan. This keeps individual round-trip payloads small
 *   and predictable across the cross-region link.
 */
const TRACKED_STATIONS = ['STN-001', 'STN-002', 'STN-003'];

app.get('/telemetry', async (req, res) => {
  try {
    const { station_id, limit } = req.query;
    const logLimit = Math.min(parseInt(limit, 10) || 50, 200);

    // If a specific station is requested, return its recent logs only
    if (station_id) {
      const logs = await Telemetry
        .find({ station_id })
        .sort({ timestamp: -1 })
        .limit(logLimit)
        .lean();

      return res.json({ station_id, count: logs.length, logs });
    }

    // Otherwise: latest snapshot per tracked station + global tail
    const [latestPerStation, recentLogs] = await Promise.all([
      // One query per tracked station, run in parallel
      Promise.all(
        TRACKED_STATIONS.map((id) =>
          Telemetry
            .findOne({ station_id: id })
            .sort({ timestamp: -1 })
            .lean()
        )
      ),
      // Global recent log tail for the live feed table
      Telemetry
        .find()
        .sort({ timestamp: -1 })
        .limit(logLimit)
        .lean(),
    ]);

    return res.json({
      // Filter out nulls for stations that have no data yet
      latest_per_station: latestPerStation.filter(Boolean),
      recent_logs:        recentLogs,
    });
  } catch (err) {
    console.error('[GET /telemetry] Error:', err.message);
    return res.status(500).json({
      error:   'Failed to fetch telemetry records.',
      details: err.message,
    });
  }
});

// ─────────────────────────────────────────────
// START SERVER
// ─────────────────────────────────────────────
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`[APP] 🚀 EV Telemetry server running on port ${PORT}`);
});