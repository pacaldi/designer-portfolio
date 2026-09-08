let video;
let canvas;
let ctx;
let facemesh;
let results = [];
let lAnalyser;
let rAnalyser;
let lFreqAnalyser;
let audioCtx;
let audioReady = false;
let smoothedLevel = 0;
let smoothedX = 0;
let smoothedY = 0;
let smoothedDb = -70;

// Soglie di colore in base al volume (dB)
const DB_VERDE = -45;
const DB_GIALLO = -30;
const DB_ARANCIO = -15;

function setup() {
    video = document.getElementById('video');
    canvas = document.getElementById('canvas');
    ctx = canvas.getContext('2d');
    
    canvas.width = 640;
    canvas.height = 480;
    
    document.getElementById('startBtn').addEventListener('click', startCamera);
}

async function startCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: 640, height: 480, facingMode: 'user' }
        });
        video.srcObject = stream;
        
        video.onloadedmetadata = () => {
            video.play();
            initFacemesh();
        };
        
        setupAudio();
        
        document.getElementById('startBtn').textContent = 'ESPERIENZA ATTIVA';
        document.getElementById('startBtn').disabled = true;
    } catch (err) {
        console.error('Errore accesso camera:', err);
        alert('Impossibile accedere alla camera');
    }
}

async function setupAudio() {
    try {
        await Tone.start();
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const source = audioCtx.createMediaStreamSource(stream);

        // Amplificazione del microfono (sensibilità ridotta)
        const gainNode = audioCtx.createGain();
        gainNode.gain.value = 0.375;
        source.connect(gainNode);

        const splitter = audioCtx.createChannelSplitter(2);
        gainNode.connect(splitter);

        lAnalyser = audioCtx.createAnalyser();
        lAnalyser.fftSize = 512;
        rAnalyser = audioCtx.createAnalyser();
        rAnalyser.fftSize = 512;
        lFreqAnalyser = audioCtx.createAnalyser();
        lFreqAnalyser.fftSize = 512;

        splitter.connect(lAnalyser, 0);
        splitter.connect(rAnalyser, 1);
        splitter.connect(lFreqAnalyser, 0);

        audioReady = true;
        console.log('Audio attivo');
    } catch (err) {
        console.error('Errore audio:', err);
    }
}

function getAudioData() {
    if (!audioReady) {
        smoothedLevel = 0;
        smoothedX = 0;
        smoothedY = 0;
        return { level: 0, x: 0, y: 0 };
    }

    // Livello energetico canale sinistro
    const timeDataL = new Float32Array(lAnalyser.fftSize);
    lAnalyser.getFloatTimeDomainData(timeDataL);
    let sumL = 0;
    for (let i = 0; i < timeDataL.length; i++) {
        sumL += timeDataL[i] * timeDataL[i];
    }
    const rmsL = Math.sqrt(sumL / timeDataL.length);

    // Livello energetico canale destro
    const timeDataR = new Float32Array(rAnalyser.fftSize);
    rAnalyser.getFloatTimeDomainData(timeDataR);
    let sumR = 0;
    for (let i = 0; i < timeDataR.length; i++) {
        sumR += timeDataR[i] * timeDataR[i];
    }
    const rmsR = Math.sqrt(sumR / timeDataR.length);

    const dbL = 20 * Math.log10(rmsL + 1e-8);
    const dbR = 20 * Math.log10(rmsR + 1e-8);
    // Sensibilità audio triplicata
    const levelTarget = Math.min(1, Math.max(0, ((dbL + dbR) / 2 + 70) / 70 * 3));

    // Direzione sinistra/destra dal bilanciamento dei canali stereo
    const rawX = (rmsR - rmsL) / (rmsL + rmsR + 1e-6);

    // Ease in/out per livello
    const easingLevel = levelTarget > smoothedLevel ? 0.15 : 0.06;
    smoothedLevel += (levelTarget - smoothedLevel) * easingLevel;

    // Livello in dB smussato per i cromatismi
    const dbAvg = (dbL + dbR) / 2;
    smoothedDb += (dbAvg - smoothedDb) * (dbAvg > smoothedDb ? 0.15 : 0.06);

    const easingX = Math.abs(rawX) >= Math.abs(smoothedX) ? 0.15 : 0.06;
    smoothedX += (rawX - smoothedX) * easingX;

    // Smoothstep per un effetto morbido senza picchi
    const t = Math.min(1, Math.max(0, smoothedLevel));
    const level = t * t * (3 - 2 * t);

    return {
        level: level,
        db: smoothedDb,
        // Solo asse X (stereo); Y sempre frontale per evitare zone verdi indesiderate
        x: Math.abs(smoothedX) > 0.05 ? Math.max(-1, Math.min(1, smoothedX)) : 0,
        y: 0
    };
}

function initFacemesh() {
    facemesh = ml5.facemesh(video, modelReady);
}

function modelReady() {
    console.log('Facemesh model pronto!');
    facemesh.on('predict', gotResults);
}

function gotResults(faceResults) {
    results = faceResults;
    draw();
}

function colorFromLevel(db) {
    if (db >= DB_ARANCIO) return [255, 50, 0];   // rosso
    if (db >= DB_GIALLO) return [255, 140, 0];   // arancio
    if (db >= DB_VERDE) return [255, 230, 0];    // giallo
    return [50, 240, 60];                        // verde
}

function draw() {
    // Dissolvenza progressiva: crea la scia (trail) di ~1 secondo
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.globalCompositeOperation = 'lighter';

    const time = Date.now() * 0.01;
    const audio = getAudioData();
    const audioLevel = audio.level;
    const dirX = audio.x;
    const dirY = audio.y;

    if (results.length > 0) {
        for (let i = 0; i < results.length; i++) {
            const face = results[i];
            const keypoints = face.scaledMesh;

            // Calcola il centroide della faccia
            let cx = 0;
            let cy = 0;
            for (let j = 0; j < keypoints.length; j++) {
                cx += keypoints[j][0];
                cy += keypoints[j][1];
            }
            cx /= keypoints.length;
            cy /= keypoints.length;

            // Primo passaggio: calcola posizioni e proiezioni sulla direzione del suono
            const pts = [];
            const projs = [];
            let maxProj = -Infinity;
            let minProj = Infinity;
            for (let j = 0; j < keypoints.length; j++) {
                const point = keypoints[j];
                // Allontana i punti dal centro di 6 volte
                const px = cx + (point[0] - cx) * 6;
                const py = cy + (point[1] - cy) * 6;

                // Posizione normalizzata del punto rispetto al centro (-1..1)
                const nx = Math.max(-1, Math.min(1, (px - cx) / (canvas.width / 2)));
                const ny = Math.max(-1, Math.min(1, (py - cy) / (canvas.height / 2)));

                // Proiezione sulla direzione del suono (x invertita per il mirror del canvas)
                const proj = -nx * dirX + ny * dirY;

                pts.push({ px: px, py: py, nx: nx, ny: ny });
                projs.push(proj);
                if (proj > maxProj) maxProj = proj;
                if (proj < minProj) minProj = proj;
            }

            // Secondo passaggio: disegna i punti
            for (let j = 0; j < pts.length; j++) {
                const p = pts[j];
                const twinkle = 0.6 + 0.4 * Math.sin(time + j * 7);

                // Quanto il punto è allineato alla direzione del suono (0..1 su tutta la mesh)
                const s = (projs[j] - minProj) / ((maxProj - minProj) + 1e-6);

                // Quanto il punto è allineato alla direzione del suono (0..1)
                const m = s;
                // Sharpening forte: amplifica il contrasto direzionale
                const match = m * m * m * m;

                const sizeFactor = Math.random() * Math.random() * (1 + audioLevel * 6 * (0.1 + 0.9 * match));

                // Colore dalle soglie di volume, applicato solo ai punti allineati
                // alla provenienza del suono (sinistra/destra), sfumato al bianco per il resto
                const thresholdColor = colorFromLevel(audio.db);
                const greenAmount = Math.min(1, Math.max(0, (s - 0.5) / 0.2));
                const color = [
                    Math.round(255 + (thresholdColor[0] - 255) * greenAmount),
                    Math.round(255 + (thresholdColor[1] - 255) * greenAmount),
                    Math.round(255 + (thresholdColor[2] - 255) * greenAmount)
                ];

                drawStar(p.px, p.py, twinkle, sizeFactor, color);
            }
        }
    }

    ctx.globalCompositeOperation = 'source-over';
}

function drawStar(x, y, twinkle, sizeFactor, color) {
    // Bagliore esterno
    ctx.fillStyle = 'rgba(' + color[0] + ',' + color[1] + ',' + color[2] + ',' + (0.25 * twinkle).toFixed(3) + ')';
    ctx.beginPath();
    ctx.arc(x, y, 3.5 * sizeFactor, 0, 2 * Math.PI);
    ctx.fill();

    // Bagliore intermedio
    ctx.fillStyle = 'rgba(' + color[0] + ',' + color[1] + ',' + color[2] + ',' + (0.5 * twinkle).toFixed(3) + ')';
    ctx.beginPath();
    ctx.arc(x, y, 2 * sizeFactor, 0, 2 * Math.PI);
    ctx.fill();

    // Nucleo luminoso
    ctx.fillStyle = 'rgba(' + color[0] + ',' + color[1] + ',' + color[2] + ',' + (0.9 * twinkle).toFixed(3) + ')';
    ctx.beginPath();
    ctx.arc(x, y, 1.2 * sizeFactor, 0, 2 * Math.PI);
    ctx.fill();
}

window.onload = setup;