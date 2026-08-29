/**
 * circuits.js — Central Circuit Configuration
 */

const TEAMS = [
  'Red Bull', 'Mercedes', 'Ferrari', 'McLaren', 'Aston Martin',
  'Alpine', 'Williams', 'RB', 'Sauber', 'Haas'
];

function generateBoxes(startProg, endProg) {
  const span = endProg - startProg;
  const step = span / Math.max(1, TEAMS.length - 1);
  return TEAMS.map((team, i) => ({
    team,
    progress: startProg + (i * step)
  }));
}

const PATH_SINGAPORE = 'M 400,80 C 550,80 650,120 680,200 C 710,280 720,350 700,420 C 680,490 620,530 550,540 C 480,550 420,555 350,540 C 280,525 200,500 150,440 C 100,380 80,300 100,220 C 120,140 200,80 300,75 C 340,73 370,77 400,80 Z';
const SINGAPORE = {
  id: 'singapore',
  name: 'Singapore',
  fullName: 'Marina Bay Street Circuit',
  lengthKm: 4.940,
  type: 'Street',
  hasRealModel: true,
  baseLapTimeSec: 94.0,
  raceLaps: 61,
  circuit: { centerline: PATH_SINGAPORE },
  pitLane: {
    entryProgress: 0.91,
    centerline: 'M 220,77 C 240,30 260,30 280,30 L 420,30 C 450,30 460,50 480,80',
    exitProgress: 0.05,
    boxes: generateBoxes(0.2, 0.8)
  }
};

const PATH_MONACO = 'M 450,100 C 550,100 650,120 650,200 C 650,300 600,350 500,350 C 480,350 460,330 460,300 C 460,270 500,270 500,300 C 500,380 400,420 300,420 C 200,420 150,380 150,300 C 150,200 300,100 450,100 Z';
const MONACO = {
  id: 'monaco',
  name: 'Monaco',
  fullName: 'Circuit de Monaco',
  lengthKm: 3.337,
  type: 'Street',
  hasRealModel: false,
  baseLapTimeSec: 74.0,
  raceLaps: 78,
  circuit: { centerline: PATH_MONACO },
  pitLane: {
    entryProgress: 0.93,
    centerline: 'M 360,100 C 370,50 390,50 400,50 L 500,50 C 520,50 530,70 540,100',
    exitProgress: 0.05,
    boxes: generateBoxes(0.2, 0.8)
  }
};

const PATH_MONZA = 'M 300,50 C 400,50 650,200 650,300 C 650,450 600,500 500,500 C 400,500 350,450 350,350 C 350,300 320,300 300,350 C 250,450 150,450 100,350 C 50,250 150,50 300,50 Z';
const MONZA = {
  id: 'monza',
  name: 'Monza',
  fullName: 'Autodromo Nazionale Monza',
  lengthKm: 5.793,
  type: 'Permanent',
  hasRealModel: false,
  baseLapTimeSec: 83.0,
  raceLaps: 53,
  circuit: { centerline: PATH_MONZA },
  pitLane: {
    entryProgress: 0.89,
    centerline: 'M 190,50 C 210,10 230,10 250,10 L 350,10 C 370,10 380,30 390,50',
    exitProgress: 0.08,
    boxes: generateBoxes(0.2, 0.8)
  }
};

export const CIRCUITS = { singapore: SINGAPORE, monaco: MONACO, monza: MONZA };
