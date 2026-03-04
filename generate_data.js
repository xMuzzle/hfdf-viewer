#!/usr/bin/env node
// Generates random HFDF transmissions into data.json.
// Each transmission has 1 or 2 geographic cluster centers; all bursts
// scatter near a chosen center (simulating real DF fix uncertainty).

const fs   = require('fs');
const path = require('path');

const NUM_TRANSMISSIONS = 20;
const MAX_BURSTS        = 15;
// Jitter in degrees around a cluster center (represents DF uncertainty)
const JITTER_DEG        = 12;
// Minimum angular separation (lat+lon) required between two cluster centers
const MIN_CLUSTER_SEP   = 45;

const HF_FREQS = [
  3000, 4000, 5000, 6000, 7000, 8000, 9000,
  10000, 11000, 12000, 13000, 14000, 15000,
  16000, 17000, 18000, 19000, 20000, 21000,
  22000, 23000, 24000, 25000, 26000, 27000, 28000
]; // kHz — stored as Hz (×1000)

function rand(min, max)    { return Math.random() * (max - min) + min; }
function randInt(min, max) { return Math.floor(rand(min, max + 1)); }

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function isoDate(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function randCenter() {
  return { lat: rand(-60, 60), lon: rand(-180, 180) };
}

// Wrap longitude into -180..180
function wrapLon(lon) {
  while (lon >  180) lon -= 360;
  while (lon < -180) lon += 360;
  return lon;
}

// Clamp latitude to valid range
function clampLat(lat) {
  return Math.max(-70, Math.min(70, lat));
}

// Generate a burst lat/lon near a cluster center with random jitter
function jitteredPoint(center) {
  return {
    latitude:  parseFloat(clampLat(center.lat + rand(-JITTER_DEG, JITTER_DEG)).toFixed(4)),
    longitude: parseFloat(wrapLon(center.lon   + rand(-JITTER_DEG, JITTER_DEG)).toFixed(4))
  };
}

const baseTime = new Date('2024-03-15T00:00:00Z');

const transmissions = Array.from({ length: NUM_TRANSMISSIONS }, () => {
  const numBursts = randInt(1, MAX_BURSTS);
  const freqKHz   = HF_FREQS[randInt(0, HF_FREQS.length - 1)];
  const frequency = (freqKHz + randInt(-450, 450)) * 1000;

  // 1 or 2 cluster centers per transmission
  const numClusters = randInt(1, 2);
  const clusters    = [randCenter()];
  if (numClusters === 2) {
    let c2;
    // Retry until the second center is far enough from the first
    do { c2 = randCenter(); }
    while (Math.abs(c2.lat - clusters[0].lat) + Math.abs(c2.lon - clusters[0].lon) < MIN_CLUSTER_SEP);
    clusters.push(c2);
  }

  // TX window wide enough to hold all bursts
  const txStartMs = baseTime.getTime() + randInt(0, 22 * 3600) * 1000;
  const txDurSec  = randInt(numBursts * 120, numBursts * 600 + 1800);
  const txStart   = new Date(txStartMs);
  const txEnd     = new Date(txStartMs + txDurSec * 1000);

  // Burst start times — random within TX window, sorted ascending
  const burstMs = Array.from({ length: numBursts }, () =>
    txStartMs + randInt(30, txDurSec - 30) * 1000
  ).sort((a, b) => a - b);

  const bursts = burstMs.map(ms => {
    const center = clusters[randInt(0, clusters.length - 1)];
    const { latitude, longitude } = jitteredPoint(center);
    return {
      startTime:   isoDate(new Date(ms)),
      payload:     [],
      latitude,
      longitude,
      major_axis:  parseFloat(rand(90, 160).toFixed(1)),
      minor_axis:  parseFloat(rand(50, 105).toFixed(1)),
      orientation: parseFloat(rand(0, 360).toFixed(1))
    };
  });

  return {
    transmissionUUID: uuid(),
    frequency,
    startTime:  isoDate(txStart),
    endTime:    isoDate(txEnd),
    numBursts,
    bursts
  };
});

const output  = { "$schema": "./schema.json", transmissions };
const outPath = path.join(__dirname, 'data.json');
fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

const totalBursts = transmissions.reduce((s, t) => s + t.bursts.length, 0);
const twoClusters = transmissions.filter(t => {
  // detect by checking spread: rough heuristic
  const lats = t.bursts.map(b => b.latitude);
  return (Math.max(...lats) - Math.min(...lats)) > JITTER_DEG * 2.5;
}).length;
console.log(`Wrote ${NUM_TRANSMISSIONS} TX, ${totalBursts} bursts (≈${twoClusters} dual-cluster TX) → ${outPath}`);
