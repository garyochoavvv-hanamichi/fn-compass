import React, {useMemo, useRef, useState} from 'react';
import {
  Alert,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Pressable,
  Platform,
  PermissionsAndroid,
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
const RTC_CONFIG = {iceServers: [{urls: 'stun:stun.l.google.com:19302'}]};

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
  const text = await response.text();
  const data = decodeSuperjson(text);
  if (!response.ok || data?.error) {
    throw new Error(data?.error || 'Error de red');
  }
  return data;
}

function FocusButton({
  title,
  subtitle,
  onPress,
  danger = false,
}: {
  title: string;
  subtitle?: string;
  onPress: () => void;
  danger?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      hasTVPreferredFocus={false}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={[
        styles.button,
        focused && styles.buttonFocused,
        danger && styles.buttonDanger,
      ]}>
      <Text style={styles.buttonTitle}>{title}</Text>
      {!!subtitle && <Text style={styles.buttonSubtitle}>{subtitle}</Text>}
    </Pressable>
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
  const [streamURL, setStreamURL] = useState<string | null>(null);

  const pcRef = useRef<any>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const screenRef = useRef<any>(null);
  const micRef = useRef<any>(null);
  const clientId = useRef('tv-' + Math.random().toString(36).slice(2, 10)).current;

  const channel = useMemo(() => (room ? 'room:' + room : ''), [room]);

  async function sendSignal(message: Omit<Signal, 'from'>) {
    if (!channel) return;
    await postSuperjson('/_api/_realtime/send', {
      channel,
      data: {...message, from: clientId},
    });
  }

  function createPeer(activeRole: Role) {
    if (pcRef.current) return pcRef.current;

    const pc = new RTCPeerConnection(RTC_CONFIG as any);
    pcRef.current = pc;

    pc.onicecandidate = (event: any) => {
      if (event.candidate) {
        sendSignal({
          type: 'ice',
          candidate: event.candidate.toJSON
            ? event.candidate.toJSON()
            : event.candidate,
        } as any).catch(() => {});
      }
    };

    pc.ontrack = (event: any) => {
      const remoteStream =
        event.streams?.[0] || new MediaStream(event.track ? [event.track] : []);
      if (remoteStream?.toURL) {
        setStreamURL(remoteStream.toURL());
      }
      setConnected(true);
      setStatus('P2P CONECTADO');
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      setConnected(state === 'connected');
      if (state === 'connected') setStatus('P2P CONECTADO');
      if (state === 'connecting') setStatus('CONECTANDO P2P');
      if (state === 'disconnected') setStatus('RECONECTANDO');
      if (state === 'failed') setStatus('CONEXIÓN FALLIDA · TURN RECOMENDADO');
    };

    return pc;
  }

  async function connectSignaling(activeRoom: string, activeRole: Role) {
    setStatus('CONECTANDO SALA');
    const token = await postSuperjson('/_api/_realtime/token', {});
    const ws = new WebSocket(
      token.wssEndpoint + '?token=' + encodeURIComponent(token.token),
    );
    wsRef.current = ws;
    const pc = createPeer(activeRole);

    ws.onopen = () => {
      ws.send(JSON.stringify({action: 'subscribe', channel: 'room:' + activeRoom}));
      setStatus('EN LÍNEA');
      if (activeRole === 'guest') {
        sendSignal({type: 'guest-ready'} as any).catch(() => {});
      }
    };

    ws.onmessage = async event => {
      try {
        const envelope = JSON.parse(String(event.data));
        const msg: Signal | undefined = envelope?.data;
        if (!msg || msg.from === clientId) return;

        if (msg.type === 'guest-ready' && activeRole === 'host') {
          setStatus('INVITADO DETECTADO');
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          await sendSignal({type: 'offer', sdp: offer} as any);
          return;
        }

        if (msg.type === 'offer' && activeRole === 'guest') {
          await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await sendSignal({type: 'answer', sdp: answer} as any);
          setStatus('RECIBIENDO TRANSMISIÓN');
          return;
        }

        if (msg.type === 'answer' && activeRole === 'host') {
          await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
          return;
        }

        if (msg.type === 'ice' && msg.candidate) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
          } catch {}
          return;
        }

        if (msg.type === 'host-left' && activeRole === 'guest') {
          setStatus('EL HOST SALIÓ');
          setConnected(false);
        }
      } catch {}
    };

    ws.onerror = () => setStatus('ERROR DE SEÑALIZACIÓN');
    ws.onclose = () => {
      if (page === 'room') setStatus('SALA DESCONECTADA');
    };
  }

  async function enterHost() {
    const code = randomCode();
    setRole('host');
    setRoom(code);
    setPage('room');
    setTimeout(() => connectSignaling(code, 'host').catch(showError), 50);
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
    setRole('guest');
    setRoom(code);
    setPage('room');
    setTimeout(() => connectSignaling(code, 'guest').catch(showError), 50);
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
      const pc = createPeer(role);
      stream.getTracks().forEach((track: any) => pc.addTrack(track, stream));
      setMicOn(true);

      if (role === 'host') {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await sendSignal({type: 'offer', sdp: offer} as any);
      }
    } catch (error) {
      showError(error);
    }
  }

  async function shareScreen() {
    try {
      setStatus('SOLICITANDO CAPTURA');
      const stream: any = await mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
        android: {
          createConfigForDefaultDisplay: true,
          resolutionScale: 1.0,
        },
      } as any);

      screenRef.current = stream;
      setStreamURL(stream.toURL());
      setSharing(true);

      const pc = createPeer('host');
      stream.getTracks().forEach((track: any) => pc.addTrack(track, stream));

      const videoSender = pc
        .getSenders()
        .find((sender: any) => sender.track?.kind === 'video');
      if (videoSender) {
        try {
          const parameters = videoSender.getParameters();
          parameters.encodings =
            parameters.encodings?.length > 0 ? parameters.encodings : [{}];
          parameters.encodings[0].maxBitrate = 12000000;
          parameters.degradationPreference = 'maintain-resolution';
          await videoSender.setParameters(parameters);
        } catch {}
      }

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await sendSignal({type: 'offer', sdp: offer} as any);
      setStatus('TRANSMITIENDO · 1080p / HASTA 60 FPS');
    } catch (error) {
      setSharing(false);
      showError(error);
    }
  }

  async function leaveRoom() {
    if (role === 'host') {
      sendSignal({type: 'host-left'} as any).catch(() => {});
    }
    screenRef.current?.getTracks?.().forEach((track: any) => track.stop());
    micRef.current?.getTracks?.().forEach((track: any) => track.stop());
    pcRef.current?.close?.();
    wsRef.current?.close?.();
    screenRef.current = null;
    micRef.current = null;
    pcRef.current = null;
    wsRef.current = null;
    setStreamURL(null);
    setConnected(false);
    setSharing(false);
    setMicOn(false);
    setStatus('LISTO');
    setRoom('');
    setPage('home');
  }

  if (page === 'home') {
    return (
      <SafeAreaView style={styles.page}>
        <View style={styles.backgroundLineA} />
        <View style={styles.backgroundLineB} />
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>PRIVATE SCREENING ROOM · ANDROID TV</Text>
          <Text style={styles.title}>
            CHOREZA{'\n'}
            <Text style={styles.red}>NIGHT TV</Text>
          </Text>
          <Text style={styles.subtitle}>
            Cine privado · WebRTC · control remoto · misma sala que la web
          </Text>

          <View style={styles.homeActions}>
            <FocusButton
              title="CREAR SALA"
              subtitle="Host Android TV · código automático"
              onPress={enterHost}
            />
            <View style={styles.joinPanel}>
              <Text style={styles.joinLabel}>CÓDIGO DE SALA</Text>
              <TextInput
                value={joinCode}
                onChangeText={setJoinCode}
                maxLength={6}
                autoCapitalize="characters"
                placeholder="K7M4XP"
                placeholderTextColor="#566070"
                style={styles.input}
              />
              <FocusButton
                title="INGRESAR"
                subtitle="Entrar como invitado"
                onPress={enterGuest}
              />
            </View>
          </View>

          <Text style={styles.footnote}>
            Web compatible: choreza-night.floot.app
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.page}>
      <View style={styles.topbar}>
        <Text style={styles.brand}>
          CHOREZA <Text style={styles.red}>NIGHT TV</Text>
        </Text>
        <View style={styles.codeChip}>
          <Text style={styles.codeLabel}>SALA</Text>
          <Text style={styles.code}>{room}</Text>
        </View>
        <Text style={[styles.status, connected && styles.statusGood]}>
          {status}
        </Text>
      </View>

      <View style={styles.workspace}>
        <View style={styles.stage}>
          {streamURL ? (
            <RTCView
              streamURL={streamURL}
              style={styles.rtc}
              objectFit="contain"
              mirror={false}
            />
          ) : (
            <View style={styles.empty}>
              <Text style={styles.emptyMark}>{role === 'host' ? '◉' : '◎'}</Text>
              <Text style={styles.emptyTitle}>
                {role === 'host' ? 'LISTO PARA TRANSMITIR' : 'ESPERANDO AL HOST'}
              </Text>
              <Text style={styles.emptySubtitle}>
                {role === 'host'
                  ? 'Pulsa Compartir pantalla y acepta el permiso de Android.'
                  : 'La transmisión aparecerá aquí cuando el host se conecte.'}
              </Text>
            </View>
          )}

          <View style={styles.hud}>
            <Text style={styles.hudText}>
              {connected ? '● P2P CONECTADO' : '○ P2P ESPERANDO'}
            </Text>
            <Text style={styles.hudText}>1080p OBJETIVO</Text>
            <Text style={styles.hudText}>HASTA 60 FPS</Text>
          </View>
        </View>

        <View style={styles.sidebar}>
          <Text style={styles.eyebrow}>{role === 'host' ? 'HOST' : 'INVITADO'}</Text>
          <Text style={styles.panelTitle}>
            {role === 'host' ? 'CABINA TV' : 'SALA TV'}
          </Text>

          {role === 'host' && (
            <FocusButton
              title={sharing ? 'PANTALLA ACTIVA' : 'COMPARTIR PANTALLA'}
              subtitle="MediaProjection · 1080p objetivo"
              onPress={shareScreen}
            />
          )}

          <FocusButton
            title={micOn ? 'MICRÓFONO ACTIVO' : 'ACTIVAR MICRÓFONO'}
            subtitle="Voz separada de la película"
            onPress={toggleMic}
          />

          <View style={styles.infoCard}>
            <Text style={styles.infoTitle}>AUDIO DEL SISTEMA</Text>
            <Text style={styles.infoBody}>
              Esta primera APK transmite pantalla + voz. El audio interno de otras
              apps requiere AudioPlaybackCapture y se añadirá como pista separada
              cuando validemos compatibilidad con tu Android TV.
            </Text>
          </View>

          <View style={styles.spacer} />
          <FocusButton title="SALIR" onPress={leaveRoom} danger />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: '#07090f',
    padding: 28,
  },
  backgroundLineA: {
    position: 'absolute',
    width: 900,
    height: 3,
    backgroundColor: '#ff3d57',
    opacity: 0.22,
    top: 170,
    right: -260,
    transform: [{rotate: '-14deg'}],
  },
  backgroundLineB: {
    position: 'absolute',
    width: 760,
    height: 1,
    backgroundColor: '#65d7ff',
    opacity: 0.16,
    bottom: 120,
    left: -180,
    transform: [{rotate: '11deg'}],
  },
  hero: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 56,
  },
  eyebrow: {
    color: '#8d96a6',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 4,
    marginBottom: 14,
  },
  title: {
    color: '#f5f2ed',
    fontSize: 72,
    lineHeight: 66,
    fontWeight: '900',
    letterSpacing: -4,
  },
  red: {color: '#ff3d57'},
  subtitle: {
    color: '#9aa3b1',
    fontSize: 20,
    marginTop: 18,
    marginBottom: 34,
  },
  homeActions: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 22,
  },
  button: {
    minWidth: 300,
    minHeight: 102,
    justifyContent: 'center',
    paddingHorizontal: 26,
    paddingVertical: 18,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2a3140',
    backgroundColor: '#101522',
  },
  buttonFocused: {
    borderColor: '#ff3d57',
    backgroundColor: '#171622',
    transform: [{scale: 1.035}],
    shadowColor: '#ff3d57',
    shadowOpacity: 0.7,
    shadowRadius: 20,
  },
  buttonDanger: {
    backgroundColor: '#160c11',
    borderColor: '#4b2029',
  },
  buttonTitle: {
    color: '#f5f2ed',
    fontSize: 22,
    fontWeight: '800',
  },
  buttonSubtitle: {
    color: '#8d96a6',
    fontSize: 14,
    marginTop: 6,
  },
  joinPanel: {
    minWidth: 440,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#242b38',
    backgroundColor: '#0d111a',
    padding: 18,
    gap: 12,
  },
  joinLabel: {
    color: '#8d96a6',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 3,
  },
  input: {
    color: '#f5f2ed',
    backgroundColor: '#080b12',
    borderColor: '#313949',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 12,
    fontSize: 27,
    letterSpacing: 8,
  },
  footnote: {
    color: '#596273',
    fontSize: 13,
    marginTop: 24,
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
    fontSize: 22,
    fontWeight: '900',
  },
  codeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: '#2a3140',
    backgroundColor: '#0d111a',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  codeLabel: {
    color: '#7f8999',
    fontSize: 10,
    letterSpacing: 2,
  },
  code: {
    color: '#f5f2ed',
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 5,
  },
  status: {
    minWidth: 260,
    textAlign: 'right',
    color: '#8d96a6',
    fontSize: 12,
    fontWeight: '700',
  },
  statusGood: {color: '#58e6a9'},
  workspace: {
    flex: 1,
    flexDirection: 'row',
    gap: 18,
  },
  stage: {
    flex: 1,
    position: 'relative',
    borderWidth: 1,
    borderColor: '#242b38',
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#020304',
  },
  rtc: {flex: 1, backgroundColor: '#000'},
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  emptyMark: {
    color: '#ff3d57',
    fontSize: 58,
    marginBottom: 14,
  },
  emptyTitle: {
    color: '#f5f2ed',
    fontSize: 28,
    fontWeight: '900',
  },
  emptySubtitle: {
    color: '#8d96a6',
    fontSize: 16,
    marginTop: 10,
    maxWidth: 560,
    textAlign: 'center',
  },
  hud: {
    position: 'absolute',
    top: 14,
    left: 14,
    flexDirection: 'row',
    gap: 8,
  },
  hudText: {
    color: '#c6ccd6',
    backgroundColor: 'rgba(4,6,9,.78)',
    borderWidth: 1,
    borderColor: '#303745',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 10,
    fontWeight: '700',
  },
  sidebar: {
    width: 360,
    borderWidth: 1,
    borderColor: '#242b38',
    borderRadius: 20,
    backgroundColor: '#0c1019',
    padding: 18,
    gap: 15,
  },
  panelTitle: {
    color: '#f5f2ed',
    fontSize: 28,
    fontWeight: '900',
    marginTop: -10,
    marginBottom: 4,
  },
  infoCard: {
    backgroundColor: '#0b151a',
    borderWidth: 1,
    borderColor: '#16313a',
    borderRadius: 14,
    padding: 16,
  },
  infoTitle: {
    color: '#65d7ff',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 2,
    marginBottom: 8,
  },
  infoBody: {
    color: '#8d96a6',
    fontSize: 13,
    lineHeight: 19,
  },
  spacer: {flex: 1},
});
