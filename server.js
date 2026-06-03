const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

// Direct, explicit shard connection routing to cross the Pacific to AWS Sydney safely
const dbURI = "mongodb://singhsukhpinder827_db_user:GqV9ViLI0uZwXEt7@ac-mvh7i5b-shard-00-00.3ihlget.mongodb.net:27017,ac-mvh7i5b-shard-00-01.3ihlget.mongodb.net:27017,ac-mvh7i5b-shard-00-02.3ihlget.mongodb.net:27017/test?ssl=true&replicaSet=atlas-shard-0&authSource=admin&retryWrites=true&w=majority";

console.log("Routing direct tunnel to AWS Sydney Shards...");

mongoose.connect(dbURI, {
  serverSelectionTimeoutMS: 15000 // Give the cross-region connection 15 seconds to handshake
})
  .then(() => console.log("Database handshaking active and CONNECTED! 🎉"))
  .catch(err => console.error("Database connection error:", err));

const TelemetrySchema = new mongoose.Schema({
  station_id: String,
  voltage: Number,
  battery_level: Number,
  status: String,
  timestamp: { type: Date, default: Date.now }
});

const Telemetry = mongoose.model('Telemetry', TelemetrySchema);

// Base Route to check status instantly
app.get('/', (req, res) => {
  res.json({ 
    status: "Backend online", 
    database_state: mongoose.connection.readyState,
    message: mongoose.connection.readyState === 1 ? "Connected!" : "Disconnected"
  });
});

app.get('/telemetry', async (req, res) => {
  try {
    const stations = ['STN-001', 'STN-002', 'STN-003']; 
    const latestLogs = await Promise.all(stations.map(async (id) => {
      return await Telemetry.findOne({ station_id: id }).sort({ timestamp: -1 });
    }));
    res.json(latestLogs.filter(log => log !== null));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/telemetry', async (req, res) => {
  try {
    const newData = new Telemetry(req.body);
    await newData.save();
    res.status(201).json({ message: "Data successfully saved to cloud!", data: newData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Cloud Web Service running on port ${PORT}`);
});
