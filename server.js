const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

// Corrected cluster address matching your exact MongoDB dashboard layout
const dbURI = "mongodb+srv://singhsukhpinder827_db_user:GqV9ViLI0uZwXEt7@cluster0.3ihlget.mongodb.net/test?retryWrites=true&w=majority&appName=Cluster0";

console.log("Initiating global routing handshake to AWS Sydney Shards...");

// High-latency parameters tailored for cross-region stability
mongoose.connect(dbURI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 15000, // Extends wait time to 15 seconds for global routing
  socketTimeoutMS: 60000,          // Keeps the connection channel open longer
  connectTimeoutMS: 15000
})
  .then(() => console.log("Global connection established to AWS Sydney Cluster!"))
  .catch(err => console.error("Network path connection block:", err));

const TelemetrySchema = new mongoose.Schema({
  station_id: String,
  voltage: Number,
  battery_level: Number,
  status: String,
  timestamp: { type: Date, default: Date.now }
});

const Telemetry = mongoose.model('Telemetry', TelemetrySchema);

// Base state check
app.get('/', (req, res) => {
  res.json({ 
    status: "Backend online", 
    database_state: mongoose.connection.readyState,
    message: mongoose.connection.readyState === 1 ? "Connected!" : "Syncing global path..."
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
