import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { PerspectiveCamera, Environment, Sky } from '@react-three/drei';
import * as THREE from 'three';

// ── Track definition (waypoints for closed-loop oval + chicane) ──
const TRACK_WIDTH = 52;
const CANVAS_W = 360;
const CANVAS_H = 600;

const WAYPOINTS = [
    [180, 80],   // top start/finish
    [290, 120],
    [310, 200],
    [290, 300],
    [240, 370],
    [280, 440],
    [300, 510],
    [200, 550],
    [100, 510],
    [120, 440],
    [80, 370],
    [60, 260],
    [80, 160],
    [100, 100],
    [180, 80],   // back to start
];

const KART_COLOURS = [
    '#ff4757', '#ffa502', '#2ed573', '#1e90ff', '#a29bfe',
    '#fd79a8', '#fdcb6e', '#00cec9', '#6c5ce7', '#e17055',
    '#55efc4', '#74b9ff', '#ff7675', '#b2bec3', '#0984e3',
    '#e84393', '#00b894', '#e67e22', '#9b59b6', '#1abc9c',
];

function trackMetrics(x, y, waypoints) {
    let minDist = Infinity;
    let coveredAtMin = 0;
    let totalLen = 0;

    for (let i = 1; i < waypoints.length; i++) {
        const x1 = waypoints[i - 1][0];
        const y1 = waypoints[i - 1][1];
        const x2 = waypoints[i][0];
        const y2 = waypoints[i][1];
        const l2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
        const segLen = Math.sqrt(l2);

        let t = 0;
        if (l2 > 0) {
            t = ((x - x1) * (x2 - x1) + (y - y1) * (y2 - y1)) / l2;
            t = Math.max(0, Math.min(1, t));
        }

        const cx = x1 + t * (x2 - x1);
        const cy = y1 + t * (y2 - y1);
        const dist = Math.hypot(x - cx, y - cy);

        if (dist < minDist) {
            minDist = dist;
            coveredAtMin = totalLen + t * segLen;
        }
        totalLen += segLen;
    }
    return { progress: coveredAtMin / totalLen, offTrackResult: minDist > TRACK_WIDTH / 2 };
}

function drawTrackCanvas() {
    // Generate a massive canvas to act as the grass map
    const MAP_SIZE = 1200;
    const canvas = document.createElement('canvas');
    canvas.width = MAP_SIZE;
    canvas.height = MAP_SIZE;
    const ctx = canvas.getContext('2d');

    const offsetX = (MAP_SIZE - CANVAS_W) / 2;
    const offsetY = (MAP_SIZE - CANVAS_H) / 2;

    // Grass
    ctx.fillStyle = '#2d5a27';
    ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);

    ctx.translate(offsetX, offsetY);

    // Thick border
    ctx.lineWidth = TRACK_WIDTH + 14;
    ctx.strokeStyle = '#111';
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    WAYPOINTS.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
    ctx.stroke();

    // Road
    ctx.lineWidth = TRACK_WIDTH;
    ctx.strokeStyle = '#3d4a5a';
    ctx.beginPath();
    WAYPOINTS.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
    ctx.stroke();

    // Dashed center
    ctx.setLineDash([12, 12]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.beginPath();
    WAYPOINTS.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
    ctx.stroke();
    ctx.setLineDash([]);

    // Start line
    const sfx = WAYPOINTS[0][0];
    const sfy = WAYPOINTS[0][1];
    for (let i = 0; i < 6; i++) {
        ctx.fillStyle = i % 2 === 0 ? 'white' : 'black';
        ctx.fillRect(sfx - TRACK_WIDTH / 2 + i * (TRACK_WIDTH / 6), sfy - 6, TRACK_WIDTH / 6, 12);
    }

    return { canvas, MAP_SIZE: 1200, offsetX, offsetY };
}

const GLOBAL_MAP_SIZE = 1200;

// Procedural trees safely away from track
const generateTrees = () => {
    const trees = [];
    for (let i = 0; i < 150; i++) {
        const tx = Math.random() * GLOBAL_MAP_SIZE - GLOBAL_MAP_SIZE / 2 + CANVAS_W / 2;
        const ty = Math.random() * GLOBAL_MAP_SIZE - GLOBAL_MAP_SIZE / 2 + CANVAS_H / 2;
        const metrics = trackMetrics(tx, ty, WAYPOINTS);
        if (metrics.offTrackResult && Math.hypot(tx - CANVAS_W / 2, ty - CANVAS_H / 2) < GLOBAL_MAP_SIZE / 2.2) {
            // Keep away from road edges
            if (Math.random() > 0.3) {
                trees.push({ x: tx, z: ty, scale: 0.8 + Math.random() * 0.6 });
            }
        }
    }
    return trees;
};
const STATIC_TREES = generateTrees();

function useTrackData() {
    return useMemo(() => {
        const { canvas } = drawTrackCanvas();
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.generateMipmaps = true;

        return { tex, MAP_SIZE: GLOBAL_MAP_SIZE, trees: STATIC_TREES };
    }, []);
}

// ── Particle Exhaust System ──
function Particles({ active, parentVelocity }) {
    const group = useRef();
    const particles = useRef(Array(20).fill().map(() => ({
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        life: 0
    })));
    const dummy = useMemo(() => new THREE.Object3D(), []);

    useFrame((_, delta) => {
        if (!group.current) return;

        let shouldEmit = active && Math.abs(parentVelocity) > 10;

        particles.current.forEach((p, i) => {
            if (p.life <= 0 && shouldEmit && Math.random() > 0.5) {
                // Spawn
                p.pos.set(Math.random() * 4 - 2, 2, -10);
                p.vel.set((Math.random() - 0.5) * 5, Math.random() * 10, -Math.random() * 20 - 10);
                p.life = 1.0;
            }

            if (p.life > 0) {
                p.pos.addScaledVector(p.vel, delta);
                p.life -= delta * 2;

                dummy.position.copy(p.pos);
                const s = p.life * 1.5;
                dummy.scale.set(s, s, s);
                dummy.updateMatrix();
                group.current.setMatrixAt(i, dummy.matrix);
            } else {
                dummy.scale.set(0, 0, 0);
                dummy.updateMatrix();
                group.current.setMatrixAt(i, dummy.matrix);
            }
        });
        group.current.instanceMatrix.needsUpdate = true;
    });

    return (
        <instancedMesh ref={group} args={[null, null, 20]} castShadow>
            <boxGeometry args={[2, 2, 2]} />
            <meshStandardMaterial color="#888" transparent opacity={0.6} />
        </instancedMesh>
    );
}

// ── 3D Kart Component (Animated) ──
const KartVisuals = React.forwardRef(({ color, isLocal, state, physicsRef }, ref) => {
    const bodyRef = useRef();
    const wheelsRef = useRef([]);

    useFrame((_, dt) => {
        if (!bodyRef.current) return;

        const activeState = isLocal && physicsRef ? physicsRef.current : state;

        // Animations: Wheel Spin and Steer
        const speed = activeState.velocity || 0;
        const steer = activeState.steering || 0;

        wheelsRef.current.forEach((w, i) => {
            if (!w) return;
            // Spin wheels
            w.rotation.x += (speed / 10) * dt;
            // Steer front wheels
            if (i < 2) {
                w.rotation.y = -steer * 0.5; // Left/Right steering
            }
        });

        // Body roll (tilt opposite of turn) and pitch (tilt on accel/brake)
        if (isLocal && activeState) {
            const rollTarget = steer * (speed / 180) * 0.15;
            const pitchTarget = activeState.throttle * 0.1;
            bodyRef.current.rotation.z = THREE.MathUtils.lerp(bodyRef.current.rotation.z, rollTarget, 0.1);
            bodyRef.current.rotation.x = THREE.MathUtils.lerp(bodyRef.current.rotation.x, -pitchTarget, 0.1);
        }
    });

    return (
        <group ref={ref}>
            <group ref={bodyRef}>
                {/* Body */}
                <mesh position={[0, 4, 0]} castShadow receiveShadow>
                    <boxGeometry args={[12, 5, 20]} />
                    <meshStandardMaterial color={color} roughness={0.3} metalness={0.5} />
                </mesh>
                {/* Engine block */}
                <mesh position={[0, 7, -5]} castShadow>
                    <boxGeometry args={[8, 4, 8]} />
                    <meshStandardMaterial color="#333" roughness={0.8} />
                </mesh>
                {/* Spoiler */}
                <mesh position={[0, 10, -8]} castShadow>
                    <boxGeometry args={[14, 1, 4]} />
                    <meshStandardMaterial color="#111" />
                </mesh>
                <mesh position={[-5, 7, -8]} castShadow>
                    <boxGeometry args={[1, 3, 3]} />
                    <meshStandardMaterial color="#111" />
                </mesh>
                <mesh position={[5, 7, -8]} castShadow>
                    <boxGeometry args={[1, 3, 3]} />
                    <meshStandardMaterial color="#111" />
                </mesh>
                {/* Front Bumper */}
                <mesh position={[0, 3, 11]} castShadow>
                    <boxGeometry args={[15, 2, 4]} />
                    <meshStandardMaterial color={color} />
                </mesh>
                {/* Driver */}
                <mesh position={[0, 8, 2]} castShadow>
                    <sphereGeometry args={[3, 16, 16]} />
                    <meshStandardMaterial color={color} roughness={0.8} />
                </mesh>
            </group>

            {/* Wheels: Front Left, Front Right, Back Left, Back Right */}
            <group position={[-7, 3, 7]} ref={el => wheelsRef.current[0] = el}>
                <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
                    <cylinderGeometry args={[3.5, 3.5, 3, 16]} />
                    <meshStandardMaterial color="#111" roughness={0.9} />
                </mesh>
            </group>
            <group position={[7, 3, 7]} ref={el => wheelsRef.current[1] = el}>
                <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
                    <cylinderGeometry args={[3.5, 3.5, 3, 16]} />
                    <meshStandardMaterial color="#111" roughness={0.9} />
                </mesh>
            </group>
            <group position={[-7, 3, -6]} ref={el => wheelsRef.current[2] = el}>
                <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
                    <cylinderGeometry args={[3.5, 3.5, 4, 16]} />
                    <meshStandardMaterial color="#111" roughness={0.9} />
                </mesh>
            </group>
            <group position={[7, 3, -6]} ref={el => wheelsRef.current[3] = el}>
                <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
                    <cylinderGeometry args={[3.5, 3.5, 4, 16]} />
                    <meshStandardMaterial color="#111" roughness={0.9} />
                </mesh>
            </group>

            <Particles isLocal={isLocal} state={state} physicsRef={physicsRef} />
        </group>
    );
});

// ── Game Scene ──
function GameScene({ physicsRef, racing, setLaps, positions, players, myId, myColor }) {
    const { tex, MAP_SIZE, trees } = useTrackData();
    const myKartRef = useRef();
    const cameraRef = useRef();

    useFrame((state, delta) => {
        const dt = Math.min(delta, 0.05);

        if (!racing) return;

        // ── Advanced 2D Physics mapped to 3D ──
        const phys = physicsRef.current;
        const MAX_SPEED = 200;
        const ACCEL = 180;
        const BRAKE = 250;
        const FRICTION = 40;
        const TURN_SPEED = 2.8;

        let targetAccel = 0;
        if (phys.throttle > 0) targetAccel = ACCEL;
        else if (phys.throttle < 0) targetAccel = -BRAKE;

        phys.velocity += targetAccel * dt;

        // Apply friction
        const frictionApplied = Math.min(Math.abs(phys.velocity), FRICTION * dt);
        phys.velocity -= Math.sign(phys.velocity) * frictionApplied;

        // Steering with Drift (slip angle)
        if (Math.abs(phys.velocity) > 5) {
            const turnModifier = Math.sign(phys.velocity);
            phys.angle += phys.steering * TURN_SPEED * dt * turnModifier * (Math.abs(phys.velocity) / MAX_SPEED);

            // Introduce slip angle (drift) based on steering and speed
            const driftAmount = phys.steering * (Math.abs(phys.velocity) / MAX_SPEED) * 0.3;
            phys.driftAngle = THREE.MathUtils.lerp(phys.driftAngle || 0, driftAmount, 0.1);
        } else {
            phys.driftAngle = THREE.MathUtils.lerp(phys.driftAngle || 0, 0, 0.1);
        }

        const moveAngle = phys.angle - (phys.driftAngle || 0);

        // Translation
        phys.x += Math.cos(moveAngle) * phys.velocity * dt;
        phys.y += Math.sin(moveAngle) * phys.velocity * dt;

        // Bounds 
        if (phys.x < -MAP_SIZE / 2) { phys.x = -MAP_SIZE / 2; phys.velocity *= -0.5; }
        if (phys.x > MAP_SIZE / 2) { phys.x = MAP_SIZE / 2; phys.velocity *= -0.5; }
        if (phys.y < -MAP_SIZE / 2) { phys.y = -MAP_SIZE / 2; phys.velocity *= -0.5; }
        if (phys.y > MAP_SIZE / 2) { phys.y = MAP_SIZE / 2; phys.velocity *= -0.5; }

        // Off-track friction
        const metrics = trackMetrics(phys.x, phys.y, WAYPOINTS);
        if (metrics.offTrackResult) {
            phys.velocity *= 0.93; // aggressive slow grass
        }
        phys.velocity = Math.max(-MAX_SPEED / 2, Math.min(MAX_SPEED, phys.velocity));

        // Laps
        if (metrics.progress > 0.8 && !phys.lapThresholdReached) {
            phys.lapThresholdReached = true;
        } else if (metrics.progress < 0.2 && phys.lapThresholdReached) {
            phys.laps++;
            phys.lapThresholdReached = false;
        } else if (metrics.progress > 0.2 && metrics.progress < 0.8) {
            phys.lapThresholdReached = false;
        }

        phys.progress = metrics.progress;
        setLaps(phys.laps);

        // Apply to 3D Local Kart
        if (myKartRef.current) {
            myKartRef.current.position.set(phys.x, 0, phys.y);
            myKartRef.current.rotation.y = -phys.angle + Math.PI / 2; // +Z is front
        }

        // Advanced Trailing Camera
        if (cameraRef.current) {
            // Dynamic FOV & Distance based on speed
            const speedRatio = Math.abs(phys.velocity) / MAX_SPEED;
            const cameraDist = 70 + speedRatio * 20; // Pulls back when fast
            const cameraHeight = 40 + speedRatio * 10;

            cameraRef.current.fov = THREE.MathUtils.lerp(cameraRef.current.fov, 70 + speedRatio * 15, 0.1);
            cameraRef.current.updateProjectionMatrix();

            const targetCamX = phys.x - Math.cos(phys.angle) * cameraDist;
            const targetCamZ = phys.y - Math.sin(phys.angle) * cameraDist;

            cameraRef.current.position.lerp(new THREE.Vector3(targetCamX, cameraHeight, targetCamZ), 0.1);

            const lookAtTarget = new THREE.Vector3(
                phys.x + Math.cos(phys.angle) * 40,
                0,
                phys.y + Math.sin(phys.angle) * 40
            );

            if (!cameraRef.current.userData.lookTarget) {
                cameraRef.current.userData.lookTarget = new THREE.Vector3(phys.x, 0, phys.y);
            }
            cameraRef.current.userData.lookTarget.lerp(lookAtTarget, 0.1);
            cameraRef.current.lookAt(cameraRef.current.userData.lookTarget);
        }
    });

    return (
        <>
            <PerspectiveCamera makeDefault ref={cameraRef} fov={70} position={[CANVAS_W / 2, 200, CANVAS_H / 2]} />
            <ambientLight intensity={0.6} />
            <directionalLight position={[100, 200, 50]} intensity={1.5} castShadow />
            <Sky sunPosition={[100, 20, 100]} turbidity={0.3} rayleigh={0.5} mieCoefficient={0.005} />
            <fog attach="fog" args={['#87CEEB', 200, 600]} />

            {/* Massive Map Plane */}
            <mesh position={[CANVAS_W / 2, -0.1, CANVAS_H / 2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
                <planeGeometry args={[MAP_SIZE, MAP_SIZE]} />
                <meshStandardMaterial map={tex} roughness={0.9} />
            </mesh>

            {/* Start/Finish Arch */}
            <group position={[WAYPOINTS[0][0], 0, WAYPOINTS[0][1]]} rotation={[0, -Math.atan2(WAYPOINTS[1][1] - WAYPOINTS[0][1], WAYPOINTS[1][0] - WAYPOINTS[0][0]), 0]}>
                <mesh position={[-40, 25, 0]} castShadow><boxGeometry args={[4, 50, 4]} /><meshStandardMaterial color="#fff" /></mesh>
                <mesh position={[40, 25, 0]} castShadow><boxGeometry args={[4, 50, 4]} /><meshStandardMaterial color="#fff" /></mesh>
                <mesh position={[0, 48, 0]} castShadow><boxGeometry args={[84, 8, 4]} /><meshStandardMaterial color="#ff4757" /></mesh>
                <mesh position={[-20, 48, 0.1]}><planeGeometry args={[10, 6]} /><meshBasicMaterial color="#fff" /></mesh>
                <mesh position={[20, 48, 0.1]}><planeGeometry args={[10, 6]} /><meshBasicMaterial color="#fff" /></mesh>
            </group>

            {/* Procedural Trees */}
            {trees.map((t, i) => (
                <group key={i} position={[t.x, 0, t.z]} scale={t.scale}>
                    <mesh position={[0, 10, 0]} castShadow>
                        <cylinderGeometry args={[2, 2, 20]} />
                        <meshStandardMaterial color="#5c4033" />
                    </mesh>
                    <mesh position={[0, 25, 0]} castShadow>
                        <coneGeometry args={[12, 20, 8]} />
                        <meshStandardMaterial color="#1f4d29" />
                    </mesh>
                    <mesh position={[0, 35, 0]} castShadow>
                        <coneGeometry args={[10, 15, 8]} />
                        <meshStandardMaterial color="#2d6e3b" />
                    </mesh>
                </group>
            ))}

            {/* My Kart */}
            <KartVisuals ref={myKartRef} color={myColor} isLocal={true} physicsRef={physicsRef} />

            {/* Other Karts */}
            {positions.map((p) => {
                if (p.id === myId) return null;
                const pidx = players.findIndex(pl => pl.id === p.id);
                const color = KART_COLOURS[pidx % KART_COLOURS.length];
                // We fake velocity and steering for remote players based on simple diffs or passing values
                const fakeState = { velocity: 50, steering: 0, throttle: 1 };
                return (
                    <group key={p.id} position={[p.x || 0, 0, p.y || 0]} rotation={[0, -(p.angle || 0) + Math.PI / 2, 0]}>
                        <KartVisuals color={color} isLocal={false} state={fakeState} />
                    </group>
                );
            })}
        </>
    );
}

// ── Main Controller Component ──
export default function GoKart({ roomState, socket, roomCode, onReturnLobby }) {
    const stateRef = useRef(null);

    const physicsRef = useRef({
        x: 180,
        y: 80,
        velocity: 0,
        angle: -Math.PI / 2,
        steering: 0,
        throttle: 0,
        progress: 0,
        laps: 0,
        lapThresholdReached: false,
        driftAngle: 0
    });

    const [positions, setPositions] = useState([]);
    const [laps, setLaps] = useState(0);
    const [finished, setFinished] = useState(false);
    const [countdown, setCountdown] = useState(3);
    const [racing, setRacing] = useState(false);
    const [results, setResults] = useState(null);

    useEffect(() => {
        if (!roomState?.players || !socket.id) return;
        const myIdx = roomState.players.findIndex(p => p.id === socket.id);
        if (myIdx !== -1) {
            physicsRef.current.x = 180 + (myIdx % 2 === 0 ? -15 : 15);
            physicsRef.current.y = 80 + Math.floor(myIdx / 2) * 25;
        }
    }, [roomState?.players, socket.id]);

    const gs = roomState?.gameState;
    const myId = socket.id;
    const players = roomState?.players || [];
    const me = players.find(p => p.id === myId);
    const isHost = me?.isHost;
    const TOTAL_LAPS = gs?.totalLaps || 3;

    useEffect(() => {
        if (roomState?.state !== 'playing') return;
        let n = 3;
        setCountdown(3);
        setRacing(false);
        const iv = setInterval(() => {
            n--;
            setCountdown(n);
            if (n <= 0) { clearInterval(iv); setRacing(true); }
        }, 1000);
        return () => clearInterval(iv);
    }, [roomState?.state]);

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'ArrowUp' || e.key === 'w') physicsRef.current.throttle = 1;
            if (e.key === 'ArrowDown' || e.key === 's') physicsRef.current.throttle = -1;
            if (e.key === 'ArrowLeft' || e.key === 'a') physicsRef.current.steering = -1;
            if (e.key === 'ArrowRight' || e.key === 'd') physicsRef.current.steering = 1;
        };
        const handleKeyUp = (e) => {
            if (e.key === 'ArrowUp' || e.key === 'w') if (physicsRef.current.throttle === 1) physicsRef.current.throttle = 0;
            if (e.key === 'ArrowDown' || e.key === 's') if (physicsRef.current.throttle === -1) physicsRef.current.throttle = 0;
            if (e.key === 'ArrowLeft' || e.key === 'a') if (physicsRef.current.steering === -1) physicsRef.current.steering = 0;
            if (e.key === 'ArrowRight' || e.key === 'd') if (physicsRef.current.steering === 1) physicsRef.current.steering = 0;
        };
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
        };
    }, []);

    useEffect(() => {
        const iv = setInterval(() => {
            if (!racing) return;
            socket.emit('kart_position', {
                roomCode,
                progress: physicsRef.current.progress + physicsRef.current.laps,
                angle: physicsRef.current.angle,
                laps: physicsRef.current.laps,
                x: physicsRef.current.x,
                y: physicsRef.current.y
            });
        }, 80);
        return () => clearInterval(iv);
    }, [racing, roomCode, socket]);

    useEffect(() => {
        socket.on('kart_positions', (data) => {
            setPositions(data);
            stateRef.current = data;
        });
        socket.on('race_finished', (res) => {
            setResults(res);
            setFinished(true);
        });
        return () => {
            socket.off('kart_positions');
            socket.off('race_finished');
        };
    }, [socket]);

    useEffect(() => {
        if (laps >= TOTAL_LAPS && !finished) {
            socket.emit('kart_finished', { roomCode, laps: TOTAL_LAPS });
        }
    }, [laps, finished, TOTAL_LAPS, roomCode, socket]);

    if (finished && results) {
        return (
            <div style={{ padding: 24, textAlign: 'center' }}>
                <h2 style={{ fontSize: '1.8em', marginBottom: 8 }}>🏁 Race Over!</h2>
                <div className="glass-card" style={{ margin: '16px auto', maxWidth: 340 }}>
                    <h3 style={{ marginBottom: 12, color: '#ffd700' }}>🏆 Results</h3>
                    {results.map((r, i) => (
                        <div key={r.id} style={{
                            display: 'flex', alignItems: 'center', gap: 12,
                            padding: '10px 16px', marginBottom: 6,
                            background: r.id === myId ? 'rgba(255,215,0,0.15)' : 'rgba(255,255,255,0.05)',
                            borderRadius: 10, fontSize: '1em'
                        }}>
                            <span style={{ fontSize: '1.4em', minWidth: 32 }}>
                                {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
                            </span>
                            <span style={{ flex: 1, textAlign: 'left', fontWeight: r.id === myId ? 700 : 400 }}>{r.name}</span>
                            <span style={{ opacity: 0.7, fontSize: '0.85em' }}>{r.time}s</span>
                        </div>
                    ))}
                </div>
                {isHost && (
                    <button className="btn-primary" style={{ marginTop: 12 }} onClick={onReturnLobby}>
                        Return to Lobby
                    </button>
                )}
            </div>
        );
    }

    const myIdx = players.findIndex(p => p.id === myId);
    const myColor = KART_COLOURS[myIdx % KART_COLOURS.length];

    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minHeight: '100vh', padding: '8px 0', userSelect: 'none' }}>
            <div style={{ width: '100%', maxWidth: CANVAS_W, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 8px 8px' }}>
                <div>
                    <span style={{ fontSize: '1.2em', fontWeight: 700 }}>🏎️ 3D Go Kart</span>
                </div>
                <div style={{ fontSize: '0.85em', opacity: 0.7 }}>
                    Lap {Math.min(laps + 1, TOTAL_LAPS)}/{TOTAL_LAPS}
                </div>
                <div style={{ fontSize: '0.75em', opacity: 0.6 }}>
                    {(positions.length)} racers
                </div>
            </div>

            <div style={{ position: 'relative', width: CANVAS_W, height: CANVAS_H, touchAction: 'none', background: '#000', borderRadius: 16, overflow: 'hidden' }}>
                <Canvas shadows camera={{ position: [CANVAS_W / 2, 200, CANVAS_H / 2] }}>
                    <GameScene
                        physicsRef={physicsRef}
                        racing={racing}
                        setLaps={setLaps}
                        positions={positions}
                        players={players}
                        myId={myId}
                        myColor={myColor}
                    />
                </Canvas>

                {!racing && countdown > 0 && (
                    <div style={{
                        position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyItems: 'center', justifyContent: 'center',
                        background: 'rgba(0,0,0,0.6)'
                    }}>
                        <div style={{ fontSize: '6em', fontWeight: 900, color: countdown === 1 ? '#ff4757' : countdown === 2 ? '#ffa502' : '#2ed573', textShadow: '0 0 40px currentColor' }}>
                            {countdown}
                        </div>
                    </div>
                )}
                {!racing && countdown === 0 && (
                    <div style={{
                        position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'rgba(0,0,0,0.4)', pointerEvents: 'none'
                    }}>
                        <div style={{ fontSize: '4em', fontWeight: 900, color: '#2ed573', textShadow: '0 0 40px #2ed573' }}>GO!</div>
                    </div>
                )}

                {racing && (
                    <div style={{
                        position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)',
                        fontSize: '0.7em', opacity: 0.8, color: '#fff', pointerEvents: 'none', textShadow: '0 1px 4px rgba(0,0,0,0.8)'
                    }}>
                        💻 Arrow Keys/WASD to drive · Mobile buttons below
                    </div>
                )}
            </div>

            <div style={{ width: '100%', maxWidth: CANVAS_W, marginTop: 12, padding: '0 8px' }}>
                <div className="glass-card" style={{ padding: 12 }}>
                    <div style={{ fontSize: '0.75em', fontWeight: 700, marginBottom: 8, opacity: 0.7 }}>STANDINGS</div>
                    {[...positions].sort((a, b) => b.progress - a.progress).map((p, i) => {
                        const pname = players.find(pl => pl.id === p.id)?.name || '?';
                        const pidx = players.findIndex(pl => pl.id === p.id);
                        return (
                            <div key={p.id} style={{
                                display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0',
                                borderBottom: '1px solid rgba(255,255,255,0.05)',
                                fontWeight: p.id === myId ? 700 : 400
                            }}>
                                <span style={{ minWidth: 24, opacity: 0.7 }}>#{i + 1}</span>
                                <span style={{ width: 10, height: 10, borderRadius: '50%', background: KART_COLOURS[pidx % KART_COLOURS.length], flexShrink: 0 }} />
                                <span style={{ flex: 1, fontSize: '0.9em' }}>{pname}{p.id === myId ? ' (you)' : ''}</span>
                                <span style={{ fontSize: '0.75em', opacity: 0.6 }}>Lap {Math.min(p.laps + 1, TOTAL_LAPS)}</span>
                            </div>
                        );
                    })}
                </div>
            </div>

            {racing && (
                <div style={{ width: '100%', maxWidth: CANVAS_W, display: 'flex', justifyContent: 'space-between', padding: '8px 8px 0', marginTop: 4 }}>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button
                            style={{ padding: '20px', fontSize: '1.5em', borderRadius: 12, background: '#e17055', border: 'none', color: '#fff', fontWeight: 900, cursor: 'pointer', userSelect: 'none', touchAction: 'none' }}
                            onPointerDown={() => { physicsRef.current.steering = -1; }}
                            onPointerUp={() => { physicsRef.current.steering = 0; }}
                            onPointerOut={() => { physicsRef.current.steering = 0; }}
                        >◀</button>
                        <button
                            style={{ padding: '20px', fontSize: '1.5em', borderRadius: 12, background: '#e17055', border: 'none', color: '#fff', fontWeight: 900, cursor: 'pointer', userSelect: 'none', touchAction: 'none' }}
                            onPointerDown={() => { physicsRef.current.steering = 1; }}
                            onPointerUp={() => { physicsRef.current.steering = 0; }}
                            onPointerOut={() => { physicsRef.current.steering = 0; }}
                        >▶</button>
                    </div>

                    <div style={{ display: 'flex', gap: 8 }}>
                        <button
                            style={{ padding: '20px', fontSize: '1.2em', borderRadius: 12, background: '#ff7675', border: 'none', color: '#1a2332', fontWeight: 900, cursor: 'pointer', userSelect: 'none', touchAction: 'none' }}
                            onPointerDown={() => { physicsRef.current.throttle = -1; }}
                            onPointerUp={() => { physicsRef.current.throttle = 0; }}
                            onPointerOut={() => { physicsRef.current.throttle = 0; }}
                        >🛑</button>
                        <button
                            style={{ padding: '20px', fontSize: '1.2em', borderRadius: 12, background: '#2ed573', border: 'none', color: '#1a2332', fontWeight: 900, cursor: 'pointer', userSelect: 'none', touchAction: 'none' }}
                            onPointerDown={() => { physicsRef.current.throttle = 1; }}
                            onPointerUp={() => { physicsRef.current.throttle = 0; }}
                            onPointerOut={() => { physicsRef.current.throttle = 0; }}
                        >🚀</button>
                    </div>
                </div>
            )}
        </div>
    );
}
