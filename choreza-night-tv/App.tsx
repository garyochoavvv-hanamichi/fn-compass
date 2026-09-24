import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  Alert,
  Animated,
  BackHandler,
  DeviceEventEmitter,
  Easing,
  Image,
  NativeModules,
  PermissionsAndroid,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  mediaDevices,
  MediaStream,
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
  RTCView,
} from 'react-native-webrtc';

const API_BASE = 'https://choreza-night.floot.app';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const THEME_ROTATE_MS = 60_000;
const RTC_CONFIG = {
  iceServers: [
    {urls: 'stun:stun.l.google.com:19302'},
    {urls: 'stun:stun1.l.google.com:19302'},
  ],
};
const {ChorezaAudio} = NativeModules;

const THEMES = [
  {
    id: 'slam',
    name: 'Slam Dunk',
    tag: 'SHOHOKU',
    accent: '#ff3d57',
    glow: 'rgba(255,61,87,.35)',
    note: 'Rukawa · court memories · silence',
    image: 'https://choreza-night.floot.app/_cdn/static/97b09cb9-524c-4ca4-b5c1-dec7761ffb6c-slam-dunk.jpg',
  },
  {
    id: 'tokyo',
    name: 'Tokyo Revengers',
    tag: 'TOMAN',
    accent: '#f0d7aa',
    glow: 'rgba(240,215,170,.28)',
    note: 'Toman · white jacket · cold aura',
    image: 'https://choreza-night.floot.app/_cdn/static/913f9b38-95ee-4600-91fe-0ddd8f5ca560-tokyo-revengers.jpg',
  },
  {
    id: 'champloo',
    name: 'Samurai Champloo',
    tag: 'CHAMPLOO',
    accent: '#ff7a45',
    glow: 'rgba(255,122,69,.32)',
    note: 'Mugen · vinyl mood · red frame',
    image: 'https://choreza-night.floot.app/_cdn/static/4d1be83b-7eb9-4f83-9c60-96b443480758-samurai-champloo.jpg',
  },
  {
    id: 'naruto',
    name: 'Naruto',
    tag: 'KONOHA',
    accent: '#ff9a4d',
    glow: 'rgba(255,154,77,.32)',
    note: 'Hidden Leaf · ramen light · nostalgia',
    image: 'https://choreza-night.floot.app/_cdn/static/82216c41-4308-4a65-bc52-fdf5ce27059a-naruto.jpg',
  },
  {
    id: 'death',
    name: 'Death Note',
    tag: 'NOTE',
    accent: '#e18b83',
    glow: 'rgba(225,139,131,.28)',
    note: 'shadow mind · silence · crimson dust',
    image: 'https://choreza-night.floot.app/_cdn/static/2ba24b2c-11dc-4ede-9964-977999e2ecdb-death-note.png',
  },
  {
    id: 'kuroko',
    name: 'Kuroko no Basket',
    tag: 'ZONE',
    accent: '#65d7ff',
    glow: 'rgba(101,215,255,.32)',
    note: 'Seirin · phantom pass · blue focus',
    image: 'https://choreza-night.floot.app/_cdn/static/dd56e16d-6de0-4f1c-91c3-d72678f7b40e-kuroko-no-basket.jpg',
  },
] as const;

type Role = 'host' | 'guest';
type Signal =
  | {type: 'guest-ready'; from: string}
  | {type: 'offer'; sdp: any; from: string}
  | {type: 'answer'; sdp: any; from: string}
  | {type: 'ice'; candidate: any; from: string}
  | {type: 'host-left'; from: string};

function randomCode() {
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return result;
}

function decodeSuperjson(text: string): any {
  const parsed = JSON.parse(text);
  return parsed?.json ?? parsed;
}

async function postSuperjson(path: string, payload: any) {
  const response = await fetch(API_BASE + path, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({json: payload}),
  });
  const raw = await response.text();
  const data = decodeSuperjson(raw);
  if (!response.ok || data?.error) {
    throw new Error(data?.error || 'Error de red');
  }
  return data;
}

function FocusButton({
  title,
  subtitle,
  onPress,
  accent,
  danger = false,
  preferred = false,
}: {
  title: string;
  subtitle?: string;
  onPress: () => void;
  accent: string;
  danger?: boolean;
  preferred?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      hasTVPreferredFocus={preferred}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={[
        styles.button,
        focused && {
          borderColor: accent,
          shadowColor: accent,
          shadowOpacity: 0.72,
          shadowRadius: 20,
          transform: [{scale: 1.035}],
        },
        danger && styles.buttonDanger,
      ]}>
      <Text style={styles.buttonTitle}>{title}</Text>
      {!!subtitle && <Text style={styles.buttonSubtitle}>{subtitle}</Text>}
    </Pressable>
  );
}

function ThemeBackdrop({
  activeIndex,
  fadeValues,
  roomMode = false,
}: {
  activeIndex: number;
  fadeValues: Animated.Value[];
  roomMode?: boolean;
}) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {THEMES.map((theme, index) => (
        <Animated.Image
          key={theme.id}
          source={{uri: theme.image}}
          resizeMode="cover"
          style={[
            StyleSheet.absoluteFill,
            {
              opacity: fadeValues[index],
              transform: [{scale: roomMode ? 1.02 : 1.06}],
            },
          ]}
        />
      ))}
      <View
        style={[
          StyleSheet.absoluteFill,
          roomMode ? styles.roomBackdropShade : styles.backdropShade,
        ]}
      />
      <View
        style={[
          styles.themeGlow,
          {
            backgroundColor: THEMES[activeIndex].accent,
            opacity: roomMode ? 0.06 : 0.12,
          },
        ]}
      />
    </View>
  );
}

export default function App() {
  const [page, setPage] = useState<'home' | 'room'>('home');
  const [role, setRole] = useState<Role>('host');
  const [room, setRoom] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [status, setStatus] = useState('LISTO');
  const [connected, setConnected] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [systemAudioOn, setSystemAudioOn] = useState(false);
  const [systemAudioLevel, setSystemAudioLevel] = useState(0);
  const [streamURL, setStreamURL] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [activeThemeIndex, setActiveThemeIndex] = useState(0);

  const fadeValues = useRef(
    THEMES.map((_, index) => new Animated.Value(index === 0 ? 1 : 0)),
  ).current;
  const pcRef = useRef<any>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const screenRef = useRef<any>(null);
  const micRef = useRef<any>(null);
  const remoteStreamRef = useRef<any>(null);
  const audioDataChannelRef = useRef<any>(null);
  const pendingIceRef = useRef<any[]>([]);
  const guestReadyTimerRef = useRef<any>(null);
  const negotiatingRef = useRef(false);
  const offerQueuedRef = useRef(false);
  const videoReceivedRef = useRef(false);
  const captureStartingRef = useRef(false);
  const activeRoomRef = useRef('');
  const activeRoleRef = useRef<Role>('host');
  const clientId = useRef('tv-' + Math.random().toString(36).slice(2, 10)).current;

  const theme = THEMES[activeThemeIndex];

  useEffect(() => {
    THEMES.forEach(item => Image.prefetch(item.image).catch(() => {}));
    const timer = setInterval(() => {
      setActiveThemeIndex(current => {
        const next = (current + 1) % THEMES.length;
        Animated.parallel([
          Animated.timing(fadeValues[current], {
            toValue: 0,
            duration: 1400,
            easing: Easing.inOut(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(fadeValues[next], {
            toValue: 1,
            duration: 1400,
            easing: Easing.inOut(Easing.cubic),
            useNativeDriver: true,
          }),
        ]).start();
        return next;
      });
    }, THEME_ROTATE_MS);
    return () => clearInterval(timer);
  }, [fadeValues]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (fullscreen) {
        setFullscreen(false);
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [fullscreen]);

  useEffect(() => {
    const audioSub = DeviceEventEmitter.addListener(
      'ChorezaSystemAudio',
      (base64: string) => {
        const dc = audioDataChannelRef.current;
        if (dc?.readyState === 'open') {
          try {
            dc.send('A:' + base64);
          } catch {}
        }
      },
    );

    const stateSub = DeviceEventEmitter.addListener(
      'ChorezaSystemAudioState',
      (payload: {state?: string; level?: number}) => {
        setSystemAudioLevel(Number(payload?.level || 0));
        if (payload?.state === 'stopped') setSystemAudioOn(false);
      },
    );

    return () => {
      audioSub.remove();
      stateSub.remove();
    };
  }, []);

  function clearGuestReadyLoop() {
    if (guestReadyTimerRef.current) {
      clearInterval(guestReadyTimerRef.current);
      guestReadyTimerRef.current = null;
    }
  }

  async function publishTo(roomCode: string, message: Omit<Signal, 'from'>) {
    if (!roomCode) return;
    await postSuperjson('/_api/_realtime/send', {
      channel: 'room:' + roomCode,
      data: {...message, from: clientId},
    });
  }

  async function flushPendingIce(pc: any) {
    if (!pc?.remoteDescription) return;
    const pending = pendingIceRef.current.splice(0);
    for (const candidate of pending) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {}
    }
  }

  function aggregateRemoteTrack(event: any) {
    let remote = remoteStreamRef.current;
    if (!remote) {
      remote = new MediaStream();
      remoteStreamRef.current = remote;
    }

    const incomingTracks: any[] = [];
    if (Array.isArray(event.streams) && event.streams[0]?.getTracks) {
      incomingTracks.push(...event.streams[0].getTracks());
    } else if (event.track) {
      incomingTracks.push(event.track);
    }

    for (const track of incomingTracks) {
      const exists = remote.getTracks().some((t: any) => t.id === track.id);
      if (!exists) remote.addTrack(track);
    }

    if (remote.getVideoTracks().length > 0) {
      videoReceivedRef.current = true;
      clearGuestReadyLoop();
      setStreamURL(remote.toURL());
      setConnected(true);
      setStatus('P2P CONECTADO · VIDEO ACTIVO');
    }
  }

  function createPeer(activeRoom: string, activeRole: Role) {
    if (pcRef.current) return pcRef.current;

    const pc = new RTCPeerConnection(RTC_CONFIG as any);
    pcRef.current = pc;
    pendingIceRef.current = [];

    if (activeRole === 'host') {
      try {
        pc.addTransceiver?.('audio', {direction: 'recvonly'});
      } catch {}
      const dc = pc.createDataChannel('choreza-system-audio', {ordered: true});
      audioDataChannelRef.current = dc;
      dc.onopen = () => setStatus('P2P CONECTADO · AUDIO LISTO');
    }

    pc.ondatachannel = (event: any) => {
      const dc = event.channel;
      if (dc?.label !== 'choreza-system-audio') return;
      audioDataChannelRef.current = dc;
      dc.onmessage = (message: any) => {
        const value = String(message.data || '');
        if (value.startsWith('A:')) {
          try {
            ChorezaAudio?.playPcmBase64(value.slice(2));
          } catch {}
        }
      };
    };

    pc.onicecandidate = (event: any) => {
      if (!event.candidate) return;
      publishTo(activeRoom, {
        type: 'ice',
        candidate: event.candidate.toJSON
          ? event.candidate.toJSON()
          : event.candidate,
      } as any).catch(() => {});
    };

    pc.ontrack = aggregateRemoteTrack;

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === 'connected') {
        setConnected(true);
        if (activeRoleRef.current === 'guest' && !videoReceivedRef.current) {
          setStatus('P2P CONECTADO · ESPERANDO VIDEO');
        } else {
          setStatus('P2P CONECTADO');
        }
      } else if (state === 'connecting') {
        setStatus('CONECTANDO P2P');
      } else if (state === 'disconnected') {
        setConnected(false);
        setStatus('RECONECTANDO');
      } else if (state === 'failed') {
        setConnected(false);
        setStatus('CONEXIÓN FALLIDA · RED P2P BLOQUEADA');
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed') {
        setStatus('ICE FALLÓ · ESTA RED PUEDE REQUERIR TURN');
      }
    };

    return pc;
  }

  function addExistingTracks(pc: any) {
    const existing = new Set(
      pc.getSenders().map((sender: any) => sender.track?.id).filter(Boolean),
    );
    for (const stream of [screenRef.current, micRef.current]) {
      if (!stream) continue;
      for (const track of stream.getTracks()) {
        if (!existing.has(track.id)) pc.addTrack(track, stream);
      }
    }
  }

  async function makeOffer(roomCode: string, pcArg?: any) {
    if (activeRoleRef.current !== 'host') return;
    const pc = pcArg || createPeer(roomCode, 'host');
    addExistingTracks(pc);

    if (negotiatingRef.current || pc.signalingState !== 'stable') {
      offerQueuedRef.current = true;
      return;
    }

    try {
      negotiatingRef.current = true;
      offerQueuedRef.current = false;
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await publishTo(roomCode, {type: 'offer', sdp: offer} as any);
    } finally {
      negotiatingRef.current = false;
    }
  }

  async function connectSignaling(activeRoom: string, activeRole: Role) {
    activeRoomRef.current = activeRoom;
    activeRoleRef.current = activeRole;
    clearGuestReadyLoop();
    setStatus('CONECTANDO SALA');

    const token = await postSuperjson('/_api/_realtime/token', {});
    const ws = new WebSocket(
      token.wssEndpoint + '?token=' + encodeURIComponent(token.token),
    );
    wsRef.current = ws;
    const pc = createPeer(activeRoom, activeRole);

    ws.onopen = () => {
      ws.send(JSON.stringify({action: 'subscribe', channel: 'room:' + activeRoom}));
      setStatus('EN LÍNEA');

      if (activeRole === 'guest') {
        const announce = () =>
          publishTo(activeRoom, {type: 'guest-ready'} as any).catch(() => {});
        setTimeout(announce, 250);
        guestReadyTimerRef.current = setInterval(announce, 2500);
      }
    };

    ws.onmessage = async event => {
      try {
        const envelope = JSON.parse(String(event.data));
        if (envelope?.channel && envelope.channel !== 'room:' + activeRoom) return;
        const msg: Signal | undefined = envelope?.data;
        if (!msg || msg.from === clientId) return;

        if (msg.type === 'guest-ready' && activeRole === 'host') {
          setStatus('INVITADO DETECTADO · PREPARANDO');
          if (pc.signalingState === 'have-local-offer' && pc.localDescription) {
            await publishTo(activeRoom, {
              type: 'offer',
              sdp: pc.localDescription,
            } as any);
            return;
          }
          await makeOffer(activeRoom, pc);
          return;
        }

        if (msg.type === 'offer' && activeRole === 'guest') {
          if (pc.signalingState !== 'stable') {
            setStatus('SINCRONIZANDO OFERTA');
          }
          addExistingTracks(pc);
          await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
          await flushPendingIce(pc);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await publishTo(activeRoom, {type: 'answer', sdp: answer} as any);
          setStatus('RECIBIENDO TRANSMISIÓN');
          return;
        }

        if (
          msg.type === 'answer' &&
          activeRole === 'host' &&
          pc.signalingState === 'have-local-offer'
        ) {
          await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
          await flushPendingIce(pc);
          if (offerQueuedRef.current) {
            setTimeout(() => {
              makeOffer(activeRoom, pc).catch(() => {});
            }, 0);
          }
          return;
        }

        if (msg.type === 'ice' && msg.candidate) {
          if (!pc.remoteDescription) {
            pendingIceRef.current.push(msg.candidate);
          } else {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
            } catch {}
          }
          return;
        }

        if (msg.type === 'host-left' && activeRole === 'guest') {
          setConnected(false);
          setStreamURL(null);
          setStatus('EL HOST SALIÓ');
        }
      } catch (error: any) {
        setStatus('ERROR DE SEÑALIZACIÓN');
      }
    };

    ws.onerror = () => setStatus('ERROR DE SEÑALIZACIÓN');
    ws.onclose = () => {
      clearGuestReadyLoop();
      if (activeRoomRef.current === activeRoom) {
        setStatus('SALA DESCONECTADA');
      }
    };
  }

  function disposeConnection() {
    clearGuestReadyLoop();
    try {
      screenRef.current?.getTracks?.().forEach((track: any) => track.stop());
      micRef.current?.getTracks?.().forEach((track: any) => track.stop());
    } catch {}
    try {
      ChorezaAudio?.stopSystemAudioCapture?.();
      ChorezaAudio?.stopPlayback?.();
    } catch {}
    try {
      pcRef.current?.close?.();
      wsRef.current?.close?.();
    } catch {}
    screenRef.current = null;
    micRef.current = null;
    remoteStreamRef.current = null;
    pcRef.current = null;
    wsRef.current = null;
    audioDataChannelRef.current = null;
    pendingIceRef.current = [];
    offerQueuedRef.current = false;
    videoReceivedRef.current = false;
    setStreamURL(null);
    setFullscreen(false);
    setConnected(false);
    setSharing(false);
    setMicOn(false);
    setSystemAudioOn(false);
    setSystemAudioLevel(0);
  }

  async function enterHost() {
    disposeConnection();
    const code = randomCode();
    setRole('host');
    setRoom(code);
    setPage('room');
    activeRoomRef.current = code;
    activeRoleRef.current = 'host';
    setTimeout(() => connectSignaling(code, 'host').catch(showError), 100);
  }

  async function enterGuest() {
    const code = joinCode
      .toUpperCase()
      .replace(/[^A-HJ-NP-Z2-9]/g, '')
      .slice(0, 6);
    if (code.length !== 6) {
      Alert.alert('Código incompleto', 'Ingresa los 6 caracteres de la sala.');
      return;
    }
    disposeConnection();
    setRole('guest');
    setRoom(code);
    setPage('room');
    activeRoomRef.current = code;
    activeRoleRef.current = 'guest';
    setTimeout(() => connectSignaling(code, 'guest').catch(showError), 100);
  }

  function showError(error: any) {
    setStatus('ERROR');
    Alert.alert('CHOREZA NIGHT', error?.message || String(error));
  }

  async function requestMicPermission() {
    if (Platform.OS !== 'android') return true;
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    );
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  }

  async function toggleMic() {
    try {
      if (micRef.current) {
        const track = micRef.current.getAudioTracks?.()[0];
        if (track) {
          track.enabled = !track.enabled;
          setMicOn(track.enabled);
        }
        return;
      }
      if (!(await requestMicPermission())) {
        throw new Error('Permiso de micrófono denegado.');
      }
      const stream: any = await mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      micRef.current = stream;
      const pc = createPeer(activeRoomRef.current, activeRoleRef.current);
      addExistingTracks(pc);
      setMicOn(true);
      if (activeRoleRef.current === 'host') {
        await makeOffer(activeRoomRef.current, pc);
      } else {
        await publishTo(activeRoomRef.current, {type: 'guest-ready'} as any);
      }
    } catch (error) {
      showError(error);
    }
  }

  async function shareScreen() {
    if (captureStartingRef.current) {
      setStatus('CAPTURA YA EN PROCESO');
      return;
    }
    if (sharing && screenRef.current) {
      setStatus('PANTALLA YA ACTIVA');
      return;
    }

    captureStartingRef.current = true;
    try {
      setStatus('SOLICITANDO CAPTURA');
      // Use the standard MediaProjection flow for compatibility across
      // Android TV versions. Forcing createConfigForDefaultDisplay uses an
      // Android 14-only API and can crash older TV firmware.
      const stream: any = await mediaDevices.getDisplayMedia();

      screenRef.current?.getTracks?.().forEach((track: any) => track.stop());
      screenRef.current = stream;
      setStreamURL(stream.toURL());
      setSharing(true);

      const pc = createPeer(activeRoomRef.current, 'host');
      const videoTrack = stream.getVideoTracks?.()[0];
      const existingVideoSender = pc
        .getSenders()
        .find((sender: any) => sender.track?.kind === 'video');

      if (existingVideoSender && videoTrack) {
        await existingVideoSender.replaceTrack(videoTrack);
      } else {
        stream.getVideoTracks().forEach((track: any) => pc.addTrack(track, stream));
      }

      const videoSender = pc
        .getSenders()
        .find((sender: any) => sender.track?.kind === 'video');
      if (videoSender) {
        try {
          const parameters = videoSender.getParameters();
          parameters.encodings =
            parameters.encodings?.length > 0 ? parameters.encodings : [{}];
          parameters.encodings[0].maxBitrate = 6_000_000;
          parameters.encodings[0].maxFramerate = 30;
          parameters.degradationPreference = 'maintain-framerate';
          await videoSender.setParameters(parameters);
        } catch {}
      }

      await makeOffer(activeRoomRef.current, pc);
      setStatus('TRANSMITIENDO · 1080p / CINE 30 FPS · BAJA LATENCIA');

      /*
       * El audio interno se mantiene separado. No lo iniciamos automáticamente
       * antes de comprobar video porque algunos Android TV revocan la proyección
       * de pantalla al pedir un segundo MediaProjection. El botón de audio permite
       * activarlo después sin bloquear la transmisión de video.
       */
    } catch (error) {
      setSharing(false);
      showError(error);
    } finally {
      captureStartingRef.current = false;
    }
  }

  async function toggleSystemAudio() {
    try {
      if (systemAudioOn) {
        ChorezaAudio?.stopSystemAudioCapture?.();
        setSystemAudioOn(false);
        setStatus('VIDEO ACTIVO · AUDIO INTERNO APAGADO');
        return;
      }
      if (!(await requestMicPermission())) {
        throw new Error('Permiso de audio denegado.');
      }
      if (!ChorezaAudio?.startSystemAudioCapture) {
        throw new Error('Módulo de audio interno no disponible.');
      }
      await ChorezaAudio.startSystemAudioCapture();
      setSystemAudioOn(true);
      setStatus('VIDEO + AUDIO INTERNO ACTIVOS');
    } catch (error: any) {
      setSystemAudioOn(false);
      Alert.alert(
        'Audio interno',
        error?.message ||
          'Android no permitió capturar el audio interno de esta aplicación.',
      );
    }
  }

  async function leaveRoom() {
    if (activeRoleRef.current === 'host' && activeRoomRef.current) {
      publishTo(activeRoomRef.current, {type: 'host-left'} as any).catch(() => {});
    }
    disposeConnection();
    activeRoomRef.current = '';
    setStatus('LISTO');
    setRoom('');
    setPage('home');
  }

  if (page === 'home') {
    return (
      <SafeAreaView style={styles.page}>
        <ThemeBackdrop
          activeIndex={activeThemeIndex}
          fadeValues={fadeValues}
        />

        <View style={styles.homeShell}>
          <View style={styles.homeLeft}>
            <View style={styles.eyebrowRow}>
              <View style={[styles.liveDot, {backgroundColor: theme.accent}]} />
              <Text style={styles.eyebrow}>PRIVATE SCREENING ROOM · ANDROID TV</Text>
            </View>

            <Text style={styles.title}>CHOREZA</Text>
            <Text style={styles.outlineTitle}>NIGHT TV</Text>

            <Text style={styles.subtitle}>
              Sala privada, pantalla compartida, audio y voz. La misma experiencia
              de la web, optimizada para tu televisor y control remoto.
            </Text>

            <View
              style={[
                styles.nowPlaying,
                {borderLeftColor: theme.accent},
              ]}>
              <Text style={styles.nowLabel}>NOW PLAYING</Text>
              <View>
                <Text style={[styles.nowName, {color: theme.accent}]}>
                  {theme.name}
                </Text>
                <Text style={styles.nowNote}>{theme.note}</Text>
              </View>
            </View>

            <View style={styles.homeActions}>
              <FocusButton
                title="CREAR SALA"
                subtitle="Host Android TV · código automático"
                onPress={enterHost}
                accent={theme.accent}
                preferred
              />

              <View style={styles.joinPanel}>
                <Text style={styles.joinLabel}>INGRESAR A SALA</Text>
                <View style={styles.joinRow}>
                  <TextInput
                    value={joinCode}
                    onChangeText={setJoinCode}
                    maxLength={6}
                    autoCapitalize="characters"
                    placeholder="K7M4XP"
                    placeholderTextColor="#667080"
                    style={styles.input}
                  />
                  <FocusButton
                    title="ENTRAR"
                    subtitle="Usar código"
                    onPress={enterGuest}
                    accent={theme.accent}
                  />
                </View>
              </View>
            </View>

            <Text style={styles.footnote}>
              choreza-night.floot.app · cambio visual cada 1 min · Android API {String(Platform.Version)}
            </Text>
          </View>

        </View>
      </SafeAreaView>
    );
  }

  const isHost = role === 'host';

  return (
    <SafeAreaView style={[styles.page, fullscreen && styles.pageFullscreen]}>
      {!fullscreen && (
        <ThemeBackdrop
          activeIndex={activeThemeIndex}
          fadeValues={fadeValues}
          roomMode
        />
      )}

      {!fullscreen && (
      <View style={styles.topbar}>
        <Text style={styles.brand}>
          CHOREZA <Text style={{color: theme.accent}}>NIGHT TV</Text>
        </Text>

        <View style={styles.codeChip}>
          <Text style={styles.codeLabel}>SALA</Text>
          <Text style={styles.code}>{room}</Text>
        </View>

        <Text style={[styles.status, connected && styles.statusGood]}>
          {status}
        </Text>
      </View>
      )}

      <View style={[styles.workspace, fullscreen && styles.workspaceFullscreen]}>
        <View style={[styles.stage, fullscreen && styles.stageFullscreen]}>
          {streamURL ? (
            <RTCView
              streamURL={streamURL}
              style={styles.rtc}
              objectFit="contain"
              mirror={false}
            />
          ) : (
            <View style={styles.empty}>
              <View
                style={[
                  styles.emptyMark,
                  {borderColor: theme.accent},
                ]}>
                <View
                  style={[
                    styles.emptyMarkInner,
                    {borderColor: theme.accent},
                  ]}
                />
              </View>
              <Text style={styles.emptyTitle}>
                {isHost ? 'LISTO PARA TRANSMITIR' : 'ESPERANDO AL HOST'}
              </Text>
              <Text style={styles.emptySubtitle}>
                {isHost
                  ? 'Pulsa Compartir pantalla y acepta el permiso de Android.'
                  : 'La imagen aparecerá aquí cuando el host empiece a compartir.'}
              </Text>
            </View>
          )}

          {!fullscreen && (
            <View style={styles.hud}>
              <Text style={styles.hudText}>
                {connected ? '● P2P CONECTADO' : '○ P2P ESPERANDO'}
              </Text>
              <Text style={styles.hudText}>1080p OBJETIVO</Text>
              <Text style={styles.hudText}>CINE 30 FPS</Text>
            </View>
          )}
        </View>

        {!fullscreen && (
        <View style={styles.sidebar}>
          <Text style={styles.eyebrow}>{isHost ? 'HOST' : 'INVITADO'}</Text>
          <Text style={styles.panelTitle}>{isHost ? 'CABINA' : 'SALA TV'}</Text>

          {isHost && (
            <FocusButton
              title={sharing ? 'PANTALLA ACTIVA' : 'COMPARTIR PANTALLA'}
              subtitle="MediaProjection · 1080p objetivo"
              onPress={shareScreen}
              accent={theme.accent}
              preferred
            />
          )}

          <FocusButton
            title={micOn ? 'MICRÓFONO ACTIVO' : 'ACTIVAR MICRÓFONO'}
            subtitle="Voz separada de la película"
            onPress={toggleMic}
            accent={theme.accent}
          />

          {!!streamURL && (
            <FocusButton
              title="PANTALLA COMPLETA"
              subtitle="Video a toda la TV · Atrás para volver"
              onPress={() => setFullscreen(true)}
              accent={theme.accent}
            />
          )}

          {isHost && (
            <FocusButton
              title={systemAudioOn ? 'AUDIO INTERNO ACTIVO' : 'ACTIVAR AUDIO INTERNO'}
              subtitle={
                systemAudioOn
                  ? 'Señal ' + Math.round(systemAudioLevel * 100) + '%'
                  : 'Actívalo después de comprobar el video'
              }
              onPress={toggleSystemAudio}
              accent="#65d7ff"
            />
          )}

          <View style={styles.infoCard}>
            <Text style={styles.infoTitle}>CONEXIÓN</Text>
            <Text style={styles.infoBody}>{status}</Text>
            <Text style={styles.infoBody}>
              Si aparece “ICE falló”, esa red requiere un servidor TURN para atravesar
              NAT restrictivo.
            </Text>
          </View>

          <View style={styles.spacer} />

          <FocusButton
            title="SALIR"
            onPress={leaveRoom}
            accent={theme.accent}
            danger
          />
        </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: '#05070d',
    padding: 28,
  },
  pageFullscreen: {
    padding: 0,
    backgroundColor: '#000',
  },
  workspaceFullscreen: {
    gap: 0,
  },
  stageFullscreen: {
    borderWidth: 0,
    borderRadius: 0,
  },
  backdropShade: {
    backgroundColor: 'rgba(4,7,14,.66)',
  },
  roomBackdropShade: {
    backgroundColor: 'rgba(4,7,14,.90)',
  },
  themeGlow: {
    position: 'absolute',
    width: 560,
    height: 560,
    borderRadius: 280,
    right: -140,
    bottom: -180,
  },
  homeShell: {
    flex: 1,
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingHorizontal: 52,
  },
  homeLeft: {
    width: '100%',
    maxWidth: 1220,
  },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 18,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  eyebrow: {
    color: '#9aa3b1',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 4,
  },
  title: {
    color: '#f5f2ed',
    fontSize: 88,
    lineHeight: 80,
    fontWeight: '900',
    letterSpacing: -5,
  },
  outlineTitle: {
    color: '#6d7380',
    fontSize: 78,
    lineHeight: 75,
    fontWeight: '900',
    letterSpacing: -4,
    opacity: 0.88,
  },
  subtitle: {
    color: '#c0c7d1',
    fontSize: 18,
    lineHeight: 28,
    marginTop: 24,
    marginBottom: 20,
    maxWidth: 760,
  },
  nowPlaying: {
    width: 520,
    borderLeftWidth: 3,
    backgroundColor: 'rgba(8,12,20,.66)',
    paddingHorizontal: 18,
    paddingVertical: 13,
    marginBottom: 22,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
  },
  nowLabel: {
    color: '#87909f',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 3,
  },
  nowName: {
    fontSize: 18,
    fontWeight: '900',
  },
  nowNote: {
    color: '#9ca5b3',
    fontSize: 12,
    marginTop: 2,
  },
  homeActions: {
    flexDirection: 'row',
    gap: 18,
    alignItems: 'stretch',
  },
  button: {
    minWidth: 300,
    minHeight: 98,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2a3140',
    backgroundColor: 'rgba(13,17,26,.92)',
  },
  buttonDanger: {
    backgroundColor: 'rgba(35,8,14,.90)',
    borderColor: '#5a202d',
  },
  buttonTitle: {
    color: '#f5f2ed',
    fontSize: 21,
    fontWeight: '900',
  },
  buttonSubtitle: {
    color: '#929baa',
    fontSize: 13,
    marginTop: 6,
  },
  joinPanel: {
    minWidth: 470,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#242b38',
    backgroundColor: 'rgba(10,14,22,.92)',
    padding: 16,
    gap: 10,
  },
  joinLabel: {
    color: '#8d96a6',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 3,
  },
  joinRow: {
    flexDirection: 'row',
    gap: 10,
  },
  input: {
    minWidth: 190,
    color: '#f5f2ed',
    backgroundColor: '#070a11',
    borderColor: '#313949',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 18,
    fontSize: 26,
    letterSpacing: 7,
  },
  footnote: {
    color: '#687181',
    fontSize: 12,
    marginTop: 20,
  },
  topbar: {
    height: 66,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    marginBottom: 14,
  },
  brand: {
    flex: 1,
    color: '#f5f2ed',
    fontSize: 24,
    fontWeight: '900',
  },
  codeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: '#2a3140',
    backgroundColor: 'rgba(13,17,26,.93)',
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 11,
  },
  codeLabel: {
    color: '#7f8999',
    fontSize: 10,
    letterSpacing: 2,
  },
  code: {
    color: '#f5f2ed',
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 6,
  },
  status: {
    minWidth: 310,
    textAlign: 'right',
    color: '#9aa3b1',
    fontSize: 11,
    fontWeight: '800',
  },
  statusGood: {
    color: '#58e6a9',
  },
  workspace: {
    flex: 1,
    flexDirection: 'row',
    gap: 18,
  },
  stage: {
    flex: 1,
    position: 'relative',
    borderWidth: 1,
    borderColor: '#28303e',
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  rtc: {
    flex: 1,
    backgroundColor: '#000',
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  emptyMark: {
    width: 54,
    height: 54,
    borderWidth: 4,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  emptyMarkInner: {
    width: 28,
    height: 28,
    borderWidth: 4,
    borderRadius: 14,
  },
  emptyTitle: {
    color: '#f5f2ed',
    fontSize: 30,
    fontWeight: '900',
  },
  emptySubtitle: {
    color: '#939cab',
    fontSize: 16,
    marginTop: 12,
    maxWidth: 620,
    textAlign: 'center',
  },
  hud: {
    position: 'absolute',
    top: 18,
    left: 18,
    flexDirection: 'row',
    gap: 10,
  },
  hudText: {
    color: '#c6ccd6',
    backgroundColor: 'rgba(4,6,9,.82)',
    borderWidth: 1,
    borderColor: '#303745',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    fontSize: 10,
    fontWeight: '800',
  },
  sidebar: {
    width: 385,
    borderWidth: 1,
    borderColor: '#28303e',
    borderRadius: 20,
    backgroundColor: 'rgba(10,14,22,.93)',
    padding: 20,
    gap: 15,
  },
  panelTitle: {
    color: '#f5f2ed',
    fontSize: 30,
    fontWeight: '900',
    marginTop: -8,
    marginBottom: 4,
  },
  infoCard: {
    backgroundColor: 'rgba(8,22,27,.92)',
    borderWidth: 1,
    borderColor: '#163a43',
    borderRadius: 14,
    padding: 16,
  },
  infoTitle: {
    color: '#65d7ff',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 2,
    marginBottom: 8,
  },
  infoBody: {
    color: '#939cab',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 3,
  },
  spacer: {
    flex: 1,
  },
});
