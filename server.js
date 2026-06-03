const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

// Use the clean, direct string structure
const dbURI = "mongodb://singhsukhpinder827_db_user:GqV9ViLI0uZwXEt7@ac-mvh7i5b-shard-00-00.3ihlget.mongodb.net:27017,ac-mvh7i5b-shard-00-01.3ihlget.mongodb.net:27017,ac-mvh7i5b-shard-00-02.3ihlget.mongodb.net:27017/test?ssl=true&replicaSet=atlas-shard-0&authSource=admin&retryWrites=true&w=majority";

mongoose.connect(dbURI, {
  serverSelectionTimeoutMS: 5000 // Force it to crash immediately if it fails so we see the exact error
})
  .then(() => console.log("Database handshaking active!"))
  .catch(err => console.error("Immediate connection block:", err));

const TelemetrySchema = new mongoose.Schema({
  station_id: String,
  voltage: Number,
  battery_level: Number,
  status: String,
  timestamp: { type: Date, default: Date.now }
});

const Telemetry = mongoose.model('Telemetry', TelemetrySchema);

// Fallback Status Check Endpoint
app.get('/', (req, res) => {
  res.json({ status: "Backend online", database_state: mongoose.connection.readyState });
});

// Cleaned up GET Route
app.get('/telemetry', async (req, res) => {
  // If the database connection isn't ready, don't let it hang!
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ 
      error: "Database is not connected yet", 
      connection_state: mongoose.connection.readyState 
    });
  }

  try {
    const data = await Telemetry.find({}).limit(10);
    res.json(data);
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
