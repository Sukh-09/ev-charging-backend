const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

// Connect to your live MongoDB Atlas Cloud Database
const dbURI = "mongodb+srv://singhsukhpinder827_db_user:GqV9ViLI0uZwXEt7@cluster0.3ihlget.mongodb.net/?appName=Cluster0";
mongoose.connect(dbURI)
  .then(() => console.log("Connected to MongoDB Atlas Cloud Success!"))
  .catch(err => console.error("Database connection error:", err));

// Define Telemetry Data Schema
const TelemetrySchema = new mongoose.Schema({
  station_id: String,
  voltage: Number,
  battery_level: Number,
  status: String,
  timestamp: { type: Date, default: Date.now }
});

const Telemetry = mongoose.model('Telemetry', TelemetrySchema);

// API Endpoint 1: Receive data from your Ubuntu Simulation Pipeline (POST)
app.post('/telemetry', async (req, res) => {
  try {
    const newData = new Telemetry(req.body);
    await newData.save();
    res.status(201).json({ message: "Data successfully saved to cloud!", data: newData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API Endpoint 2: Serve data dynamically to your React Dashboard (GET)
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

app.listen(PORT, () => {
  console.log(`Cloud Web Service running on port ${PORT}`);
});
