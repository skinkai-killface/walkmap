import {
  Camera,
  GeoJSONSource,
  Layer,
  Map,
  type StyleSpecification,
  type CameraRef,
} from "@maplibre/maplibre-react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Dimensions,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  NativeModules,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type WalkPoint = {
  latitude: number;
  longitude: number;
  timestamp: number;
};

type WalkHistoryItem = {
  id: string;
  date: string;
  dayKey?: string;
  distanceKm: number;
  durationSec: number;
  newCells: number;
  totalCells?: number;
  achievementsUnlocked?: string[];
};

type Achievement = {
  id: string;
  title: string;
  description: string;
  isUnlocked: boolean;
};

type LevelInfo = {
  level: number;
  title: string;
  currentCells: number;
  currentTarget: number;
  nextTarget: number;
  progressPercent: number;
  cellsToNextLevel: number;
};

type DailyProgress = {
  dayKey: string;
  distanceKm: number;
  durationSec: number;
  newCells: number;
  walks: number;
  cellsGoalPercent: number;
  distanceGoalPercent: number;
  isGoalDone: boolean;
};

type MapGeoJsonData = {
  type: "FeatureCollection";
  features: any[];
};

type ActiveWalkData = {
  startedAt: number;
  points: WalkPoint[];
  currentWalkCells?: string[];
  distanceKm: number;
  lastRawPoint?: WalkPoint;
  isTransportPaused?: boolean;
  consecutiveSlowCount?: number;
};

type CoverageRoute = {
  id: string;
  points: WalkPoint[];
};

type AppDialogVariant = "info" | "success" | "warning" | "error" | "danger";

type AppDialogActionVariant = "primary" | "secondary" | "danger" | "copy";

type AppDialogAction = {
  text: string;
  variant?: AppDialogActionVariant;
  closeOnPress?: boolean;
  onPress?: () => void | Promise<void>;
};

type AppDialogData = {
  title: string;
  message: string;
  variant?: AppDialogVariant;
  copyText?: string;
  actions?: AppDialogAction[];
};

const STORAGE_CELLS_KEY = "walkmap_opened_cells"; // legacy: cleared/ignored in radius-only mode
const STORAGE_HISTORY_KEY = "walkmap_history";
const STORAGE_ACTIVE_WALK_KEY = "walkmap_active_walk";
const STORAGE_COVERAGE_ROUTES_KEY = "walkmap_coverage_routes";
const STORAGE_ACCENT_COLOR_KEY = "walkmap_accent_color";
const STORAGE_LOCAL_PROFILE_KEY = "walkmap_local_profile";
const STORAGE_LAST_LOCATION_KEY = "walkmap_last_location";
const LEGACY_LOCAL_SESSION_KEY = "walkmap_local_session";
const BACKGROUND_LOCATION_TASK = "walkmap_background_location_task";

const CELL_SIZE = 0.00045;
const DEFAULT_CENTER: [number, number] = [37.6173, 55.7558];
const MAP_STYLE: StyleSpecification = {
  version: 8,
  name: "WalkMap",
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [
    {
      id: "background",
      type: "background",
      paint: {
        "background-color": "#0B1020",
      },
    },
    {
      id: "osm",
      type: "raster",
      source: "osm",
      paint: {
        "raster-opacity": 1,
      },
    },
  ],
};
const UNLOCK_RADIUS_METERS = 70;
const USER_RADIUS_RING_STEPS = 64;
const COVERAGE_SAMPLE_STEP_METERS = 22;
const COVERAGE_CONTOUR_GRID_METERS = 7;
const MAX_COVERAGE_ROUTES_ON_MAP = 2000;
const MAX_COVERAGE_SAMPLE_POINTS = 35000;
const MAX_COVERAGE_CONTOUR_VERTICES = 70_000;
const EARTH_METERS_PER_DEGREE = 111_320;
const WEB_MERCATOR_RADIUS_METERS = 6_378_137;
const FOG_OUTER_RING: [number, number][] = [
  [-180, -85],
  [180, -85],
  [180, 85],
  [-180, 85],
  [-180, -85],
];

const M3_SURFACE = {
  background: "#0E1118",
  surface: "#131722",
  surfaceContainerLow: "#181C2A",
  surfaceContainer: "#1E2333",
  surfaceContainerHigh: "#262C3F",
  surfaceContainerHighest: "#2F364C",
  onSurface: "#E3E7F4",
  onSurfaceVariant: "#9FA9C2",
  outline: "rgba(255, 255, 255, 0.12)",
  outlineVariant: "rgba(255, 255, 255, 0.06)",
  error: "#FFB4AB",
  errorContainer: "rgba(235, 87, 87, 0.18)",
  onErrorContainer: "#FFDAD6",
};

const ACCENT_THEMES = [
  {
    id: "mint",
    title: "Изумруд (Emerald)",
    color: "#4EDEBE",
    primary: "#4EDEBE",
    onPrimary: "#00382E",
    primaryContainer: "rgba(78, 222, 190, 0.20)",
    onPrimaryContainer: "#73FBDA",
    secondaryContainer: "#344B44",
    onSecondaryContainer: "#CEE9DE",
    soft: "rgba(78, 222, 190, 0.16)",
    border: "rgba(78, 222, 190, 0.32)",
    foreground: "#00382E",
  },
  {
    id: "blue",
    title: "Океан (Oceanic)",
    color: "#6DB6FE",
    primary: "#6DB6FE",
    onPrimary: "#00325B",
    primaryContainer: "rgba(109, 182, 254, 0.20)",
    onPrimaryContainer: "#CEE5FF",
    secondaryContainer: "#384758",
    onSecondaryContainer: "#D6E3F7",
    soft: "rgba(109, 182, 254, 0.16)",
    border: "rgba(109, 182, 254, 0.32)",
    foreground: "#00325B",
  },
  {
    id: "violet",
    title: "Аметист (Amethyst)",
    color: "#C7B7FF",
    primary: "#C7B7FF",
    onPrimary: "#311877",
    primaryContainer: "rgba(199, 183, 255, 0.20)",
    onPrimaryContainer: "#E5DEFF",
    secondaryContainer: "#474358",
    onSecondaryContainer: "#E5DFFA",
    soft: "rgba(199, 183, 255, 0.16)",
    border: "rgba(199, 183, 255, 0.32)",
    foreground: "#311877",
  },
  {
    id: "orange",
    title: "Янтарь (Amber)",
    color: "#FFB960",
    primary: "#FFB960",
    onPrimary: "#472A00",
    primaryContainer: "rgba(255, 185, 96, 0.20)",
    onPrimaryContainer: "#FFDDB4",
    secondaryContainer: "#554433",
    onSecondaryContainer: "#FBDFCA",
    soft: "rgba(255, 185, 96, 0.16)",
    border: "rgba(255, 185, 96, 0.32)",
    foreground: "#472A00",
  },
  {
    id: "rose",
    title: "Коралл (Coral)",
    color: "#FF8B9E",
    primary: "#FF8B9E",
    onPrimary: "#561D2C",
    primaryContainer: "rgba(255, 139, 158, 0.20)",
    onPrimaryContainer: "#FFD9E0",
    secondaryContainer: "#574246",
    onSecondaryContainer: "#FBD8DD",
    soft: "rgba(255, 139, 158, 0.16)",
    border: "rgba(255, 139, 158, 0.32)",
    foreground: "#561D2C",
  },
] as const;

type AccentThemeId = (typeof ACCENT_THEMES)[number]["id"];
type AccentTheme = (typeof ACCENT_THEMES)[number];

type LocalProfile = {
  id: string;
  nickname: string;
  createdAt: number;
};


const DAILY_DISTANCE_GOAL_KM = 1;

const LEVELS = [
  { level: 1, title: "Новичок", km: 0 },
  { level: 2, title: "Гуляющий", km: 1 },
  { level: 3, title: "Исследователь", km: 5 },
  { level: 4, title: "Картограф", km: 15 },
  { level: 5, title: "Покоритель района", km: 35 },
  { level: 6, title: "Легенда маршрутов", km: 75 },
];



const WalkMapClipboard = NativeModules.WalkMapClipboard as
  | { setString?: (text: string) => Promise<void> }
  | undefined;

async function setClipboardText(text: string) {
  if (!WalkMapClipboard?.setString) {
    throw new Error(
      "WalkMapClipboard native module is not available. Rebuild the Android app after adding the native clipboard files.",
    );
  }

  await WalkMapClipboard.setString(text);
}

function fixMojibake(str: string): string {
  if (!str || typeof str !== "string") return "";
  try {
    if (/[\u0420\u0421][\u0080-\u00BF]/.test(str)) {
      const bytes = new Uint8Array(str.length);
      for (let i = 0; i < str.length; i++) {
        bytes[i] = str.charCodeAt(i) & 0xff;
      }
      const decoded = new TextDecoder("utf-8").decode(bytes);
      if (decoded && !decoded.includes("\ufffd")) {
        return decoded;
      }
    }
  } catch {}
  return str;
}

function formatRussianDate(timestampOrDate: number | Date = new Date()): string {
  const d = typeof timestampOrDate === "number" ? new Date(timestampOrDate) : timestampOrDate;
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${day}.${month}.${year}, ${hours}:${minutes}`;
}

function normalizeNickname(nickname: string) {
  const cleanNickname = fixMojibake(nickname).trim().slice(0, 220);
  return cleanNickname.length > 0 ? cleanNickname : "Гость";
}

function createLocalProfile(nickname: string): LocalProfile {
  return {
    id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    nickname: normalizeNickname(nickname),
    createdAt: Date.now(),
  };
}

async function readLocalProfile() {
  const raw = await AsyncStorage.getItem(STORAGE_LOCAL_PROFILE_KEY);

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<LocalProfile>;

    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    if (typeof parsed.id !== "string" || typeof parsed.nickname !== "string") {
      return null;
    }

    return {
      id: parsed.id,
      nickname: normalizeNickname(parsed.nickname),
      createdAt: Number(parsed.createdAt) || Date.now(),
    } satisfies LocalProfile;
  } catch {
    return null;
  }
}

async function writeLocalProfile(profile: LocalProfile) {
  await AsyncStorage.setItem(STORAGE_LOCAL_PROFILE_KEY, JSON.stringify(profile));
}

async function hasLegacyLocalProgress() {
  const savedValues = await Promise.all([
    AsyncStorage.getItem(STORAGE_CELLS_KEY),
    AsyncStorage.getItem(STORAGE_HISTORY_KEY),
    AsyncStorage.getItem(STORAGE_ACTIVE_WALK_KEY),
    AsyncStorage.getItem(STORAGE_COVERAGE_ROUTES_KEY),
    AsyncStorage.getItem(STORAGE_ACCENT_COLOR_KEY),
    AsyncStorage.getItem(LEGACY_LOCAL_SESSION_KEY),
  ]);

  return savedValues.some((value) => value !== null);
}

async function readLegacyProfileNickname() {
  const raw = await AsyncStorage.getItem(LEGACY_LOCAL_SESSION_KEY);

  if (!raw) {
    return "Гость";
  }

  try {
    const parsed = JSON.parse(raw) as { email?: unknown };

    if (typeof parsed.email !== "string") {
      return "Гость";
    }

    const [namePart] = parsed.email.split("@");
    return normalizeNickname(namePart || parsed.email);
  } catch {
    return "Гость";
  }
}



function toRadGlobal(value: number) {
  return (value * Math.PI) / 180;
}

function getDistanceKmGlobal(a: WalkPoint, b: WalkPoint) {
  const R = 6371;
  const dLat = toRadGlobal(b.latitude - a.latitude);
  const dLon = toRadGlobal(b.longitude - a.longitude);

  const lat1 = toRadGlobal(a.latitude);
  const lat2 = toRadGlobal(b.latitude);

  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function getCellIdGlobal(latitude: number, longitude: number) {
  const x = Math.floor(latitude / CELL_SIZE);
  const y = Math.floor(longitude / CELL_SIZE);

  return `${x}:${y}`;
}

async function readActiveWalkFromStorage() {
  const savedActiveWalk = await AsyncStorage.getItem(STORAGE_ACTIVE_WALK_KEY);

  if (!savedActiveWalk) return null;

  const parsedActiveWalk = JSON.parse(savedActiveWalk) as ActiveWalkData;

  if (
    !parsedActiveWalk ||
    typeof parsedActiveWalk.startedAt !== "number" ||
    !Array.isArray(parsedActiveWalk.points)
  ) {
    return null;
  }

  return parsedActiveWalk;
}

async function saveActiveWalkToStorage(activeWalk: ActiveWalkData) {
  await AsyncStorage.setItem(STORAGE_ACTIVE_WALK_KEY, JSON.stringify(activeWalk));
}

function addPointToActiveWalk(activeWalk: ActiveWalkData, newPoint: WalkPoint) {
  const lastRecordedPoint = activeWalk.points[activeWalk.points.length - 1];
  const prevPoint = activeWalk.lastRawPoint ?? lastRecordedPoint;
  activeWalk.lastRawPoint = newPoint;

  if (prevPoint) {
    const addedDistance = getDistanceKmGlobal(prevPoint, newPoint);
    const timeDiffSec = Math.max(1, (newPoint.timestamp - prevPoint.timestamp) / 1000);
    const speedKmH = (addedDistance / timeDiffSec) * 3600;

    // Filter out GPS jitter (< 3 meters)
    if (addedDistance < 0.003) {
      return activeWalk;
    }

    // Transport filter: if moving faster than 25 km/h, enter transport auto-pause
    if (speedKmH > 25) {
      activeWalk.isTransportPaused = true;
      activeWalk.consecutiveSlowCount = 0;
      return activeWalk;
    }

    // If currently paused by transport:
    if (activeWalk.isTransportPaused) {
      // Check if speed has returned to pedestrian walking speed (< 10 km/h)
      if (speedKmH < 10) {
        activeWalk.consecutiveSlowCount = (activeWalk.consecutiveSlowCount || 0) + 1;
        // Require 2 consecutive pedestrian readings (~6-10s of walking) to safely unpause
        if (activeWalk.consecutiveSlowCount >= 2) {
          activeWalk.isTransportPaused = false;
          activeWalk.consecutiveSlowCount = 0;
          // Resume tracking at newPoint without adding the transport jump to distance
          activeWalk.points.push(newPoint);
          activeWalk.currentWalkCells = [];
        }
      } else {
        activeWalk.consecutiveSlowCount = 0;
      }
      return activeWalk;
    }

    // Normal walking / jogging:
    if (addedDistance <= 0.25) {
      activeWalk.distanceKm += addedDistance;
    }
  }

  activeWalk.points.push(newPoint);
  activeWalk.currentWalkCells = [];

  // Memory protection: if active walk has too many points, keep thinned array to prevent AsyncStorage quota errors
  if (activeWalk.points.length > 5000) {
    activeWalk.points = activeWalk.points.filter((_, idx) => idx % 2 === 0 || idx === activeWalk.points.length - 1);
  }

  return activeWalk;
}

let backgroundSaveQueue: Promise<void> = Promise.resolve();

TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    return;
  }

  const locations = (data as { locations?: Location.LocationObject[] })
    ?.locations;

  if (!Array.isArray(locations) || locations.length === 0) {
    return;
  }

  backgroundSaveQueue = backgroundSaveQueue
    .then(async () => {
      try {
        const activeWalk = await readActiveWalkFromStorage();

        if (!activeWalk) {
          return;
        }

        locations.forEach((location) => {
          const newPoint: WalkPoint = {
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            timestamp: location.timestamp || Date.now(),
          };

          addPointToActiveWalk(activeWalk, newPoint);
        });

        await saveActiveWalkToStorage(activeWalk);
      } catch {
        // Фоновая задача не должна ломать приложение из-за одной неудачной записи.
      }
    })
    .catch(() => {});
});

export default function Index() {
  const [isWalking, setIsWalking] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [durationSec, setDurationSec] = useState(0);
  const [distanceKm, setDistanceKm] = useState(0);

  const [openedCells, setOpenedCells] = useState<string[]>([]);
  const [currentWalkCells, setCurrentWalkCells] = useState<string[]>([]);
  const [points, setPoints] = useState<WalkPoint[]>([]);
  const pointsRef = useRef<WalkPoint[]>([]);
  const [coverageRoutes, setCoverageRoutes] = useState<CoverageRoute[]>([]);
  const [history, setHistory] = useState<WalkHistoryItem[]>([]);
  const [currentLocation, setCurrentLocation] = useState<WalkPoint | null>(
    null,
  );
  const [debouncedLocation, setDebouncedLocation] = useState<WalkPoint | null>(
    null,
  );
  const debouncedLocationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const [resultModalVisible, setResultModalVisible] = useState(false);
  const [historyModalVisible, setHistoryModalVisible] = useState(false);
  const [statsModalVisible, setStatsModalVisible] = useState(false);
  const [achievementsModalVisible, setAchievementsModalVisible] =
    useState(false);
  const [profileModalVisible, setProfileModalVisible] = useState(false);
  const [settingsModalVisible, setSettingsModalVisible] = useState(false);
  const [finishConfirmVisible, setFinishConfirmVisible] = useState(false);
  const [finishConfirmMode, setFinishConfirmMode] = useState<"normal" | "short">(
    "normal",
  );
  const [backgroundRecordingEnabled, setBackgroundRecordingEnabled] =
    useState(false);
  const [appDialog, setAppDialog] = useState<AppDialogData | null>(null);
  const [appDialogCopied, setAppDialogCopied] = useState(false);
  const [lastResult, setLastResult] = useState<WalkHistoryItem | null>(null);

  const [localProfile, setLocalProfile] = useState<LocalProfile | null>(null);
  const [profileReady, setProfileReady] = useState(false);
  const [nicknameDraft, setNicknameDraft] = useState("");
  const [nicknameBusy, setNicknameBusy] = useState(false);
  const [accentThemeId, setAccentThemeId] = useState<AccentThemeId>("mint");
  const insets = useSafeAreaInsets();

  const cameraRef = useRef<CameraRef | null>(null);
  const locationSubscription = useRef<Location.LocationSubscription | null>(
    null,
  );
  const distanceKmRef = useRef(0);
  const EMPTY_POINTS: WalkPoint[] = useMemo(() => [], []);
  const EMPTY_STRINGS: string[] = useMemo(() => [], []);
  const accentTheme: AccentTheme =
    ACCENT_THEMES.find((theme) => theme.id === accentThemeId) ??
    ACCENT_THEMES[0];
  const userNickname = localProfile?.nickname ?? "Гость";
  const userProfileLabel = "Локальный профиль";
  const userInitial = userNickname.slice(0, 1).toUpperCase();

  useEffect(() => {
    let isMounted = true;

    AsyncStorage.getItem(STORAGE_ACCENT_COLOR_KEY)
      .then((savedAccent) => {
        if (!isMounted) return;

        const nextTheme = ACCENT_THEMES.find(
          (theme) => theme.id === savedAccent,
        );

        if (nextTheme) {
          setAccentThemeId(nextTheme.id);
        }
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, []);

  // Debounce currentLocation for expensive fog computations (3 sec delay)
  useEffect(() => {
    if (debouncedLocationTimerRef.current) {
      clearTimeout(debouncedLocationTimerRef.current);
    }

    debouncedLocationTimerRef.current = setTimeout(() => {
      setDebouncedLocation(currentLocation);
    }, 3000);

    // On first location, set immediately
    if (!debouncedLocation && currentLocation) {
      setDebouncedLocation(currentLocation);
    }

    return () => {
      if (debouncedLocationTimerRef.current) {
        clearTimeout(debouncedLocationTimerRef.current);
      }
    };
  }, [currentLocation]);

  useEffect(() => {
    let isMounted = true;

    (async () => {
      try {
        const savedProfile = await readLocalProfile();

        if (!isMounted) {
          return;
        }

        if (savedProfile) {
          setLocalProfile(savedProfile);
          setNicknameDraft(savedProfile.nickname);
          return;
        }

        if (await hasLegacyLocalProgress()) {
          const migratedProfile = createLocalProfile(
            await readLegacyProfileNickname(),
          );
          await writeLocalProfile(migratedProfile);

          if (!isMounted) {
            return;
          }

          setLocalProfile(migratedProfile);
          setNicknameDraft(migratedProfile.nickname);
          return;
        }

        setLocalProfile(null);
        setNicknameDraft("");
      } finally {
        if (isMounted) {
          setProfileReady(true);
        }
      }
    })();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!profileReady || !localProfile) {
      return;
    }

    loadData();
    getInitialLocation();

    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        syncActiveWalkFromStorage();
        refreshBackgroundRecordingStatus();
      }
    });

    refreshBackgroundRecordingStatus();

    return () => {
      appStateSubscription.remove();

      if (locationSubscription.current) {
        locationSubscription.current.remove();
      }
    };
  }, [profileReady, localProfile?.id]);

  useEffect(() => {
    if (mapReady && currentLocation) {
      moveMapTo(currentLocation);
    }
  }, [mapReady, Boolean(currentLocation)]);

  // Timer tick: update display every 3s, sync from storage every 10s
  useEffect(() => {
    let durationTimer: ReturnType<typeof setInterval> | undefined;
    let syncTimer: ReturnType<typeof setInterval> | undefined;

    if (isWalking && startedAt) {
      durationTimer = setInterval(() => {
        setDurationSec(Math.floor((Date.now() - startedAt) / 1000));
      }, 1000);

      syncTimer = setInterval(() => {
        syncActiveWalkFromStorage();
      }, 10000);
    }

    return () => {
      if (durationTimer) clearInterval(durationTimer);
      if (syncTimer) clearInterval(syncTimer);
    };
  }, [isWalking, startedAt]);

  function showAppDialog(dialog: AppDialogData) {
    setAppDialogCopied(false);
    setAppDialog({
      variant: "info",
      ...dialog,
    });
  }

  function showErrorDialog(title: string, message: string) {
    showAppDialog({
      title,
      message,
      variant: "error",
      copyText: `${title}\n${message}`,
    });
  }

  async function copyAppDialogText() {
    if (!appDialog) return;

    const textToCopy =
      appDialog.copyText || `${appDialog.title}\n${appDialog.message}`;

    try {
      await setClipboardText(textToCopy);
      setAppDialogCopied(true);
    } catch {
      setAppDialogCopied(false);
      showAppDialog({
        title: "Не удалось скопировать",
        message:
          "Модуль копирования ещё не подключён. Добавь native-файлы из архива и пересобери приложение.",
        variant: "error",
        copyText: textToCopy,
      });
    }
  }

  function getDialogIcon(variant?: AppDialogVariant) {
    if (variant === "success") return "✓";
    if (variant === "warning") return "!";
    if (variant === "error") return "!";
    if (variant === "danger") return "×";
    return "i";
  }

  function getDialogActions(dialog: AppDialogData | null): AppDialogAction[] {
    if (!dialog) return [];

    if (dialog.actions && dialog.actions.length > 0) {
      return dialog.actions;
    }

    if (dialog.variant === "error") {
      return [
        { text: "Закрыть", variant: "secondary" },
        { text: "Скопировать", variant: "copy", closeOnPress: false },
      ];
    }

    return [{ text: "Закрыть", variant: "primary" }];
  }

  async function handleAppDialogAction(action: AppDialogAction) {
    if (action.variant === "copy") {
      await copyAppDialogText();
      return;
    }

    if (action.closeOnPress !== false) {
      setAppDialog(null);
      setAppDialogCopied(false);
    }

    await action.onPress?.();
  }

  async function handleAccentThemeSelect(themeId: AccentThemeId) {
    setAccentThemeId(themeId);

    try {
      await AsyncStorage.setItem(STORAGE_ACCENT_COLOR_KEY, themeId);
    } catch {
      showAppDialog({
        title: "Не удалось сохранить цвет",
        message: "Цвет применён сейчас, но может не сохраниться после перезапуска.",
        variant: "warning",
      });
    }
  }

  function handleNicknameDraftChange(value: string) {
    setNicknameDraft(value.slice(0, 220));
  }

  async function handleCreateLocalProfile() {
    setNicknameBusy(true);

    try {
      const profile = createLocalProfile(nicknameDraft);
      await writeLocalProfile(profile);
      setLocalProfile(profile);
      setNicknameDraft(profile.nickname);
    } catch {
      showAppDialog({
        title: "Не удалось сохранить профиль",
        message: "Проверь память устройства и попробуй снова.",
        variant: "error",
      });
    } finally {
      setNicknameBusy(false);
    }
  }

  async function handleSaveNickname() {
    if (!localProfile) {
      await handleCreateLocalProfile();
      return;
    }

    const nextProfile = {
      ...localProfile,
      nickname: normalizeNickname(nicknameDraft),
    };

    setNicknameBusy(true);

    try {
      await writeLocalProfile(nextProfile);
      setLocalProfile(nextProfile);
      setNicknameDraft(nextProfile.nickname);
      showAppDialog({
        title: "Ник изменён",
        message: "Прогресс, история и открытая территория остались на месте.",
        variant: "success",
      });
    } catch {
      showAppDialog({
        title: "Не удалось сохранить ник",
        message: "Проверь память устройства и попробуй снова.",
        variant: "error",
      });
    } finally {
      setNicknameBusy(false);
    }
  }

  async function loadData() {
    try {
      const savedCells = await AsyncStorage.getItem(STORAGE_CELLS_KEY);
      const savedHistory = await AsyncStorage.getItem(STORAGE_HISTORY_KEY);
      const savedCoverageRoutes = await AsyncStorage.getItem(
        STORAGE_COVERAGE_ROUTES_KEY,
      );

      if (savedCells) {
        const parsedCells = JSON.parse(savedCells);

        if (Array.isArray(parsedCells)) {
          setOpenedCells(
            parsedCells.filter((cellId) => typeof cellId === "string"),
          );
        }
      }

      if (savedHistory) {
        const parsedHistory = JSON.parse(savedHistory);

        if (Array.isArray(parsedHistory)) {
          const sanitizedHistory = parsedHistory.map((item: any) => ({
            ...item,
            date: fixMojibake(typeof item.date === "string" ? item.date : ""),
          }));
          setHistory(sanitizedHistory);
        }
      }

      if (savedCoverageRoutes) {
        const parsedCoverageRoutes = JSON.parse(savedCoverageRoutes);

        if (Array.isArray(parsedCoverageRoutes)) {
          const cleanRoutes = parsedCoverageRoutes
            .filter(
              (route) =>
                route &&
                typeof route.id === "string" &&
                Array.isArray(route.points),
            )
            .map((route) => ({
              id: route.id,
              points: route.points.filter(isValidWalkPoint),
            }))
            .filter((route) => route.points.length > 0);

          setCoverageRoutes(cleanRoutes);
        }
      }

      const savedLastLocation = await AsyncStorage.getItem(
        STORAGE_LAST_LOCATION_KEY,
      );
      if (savedLastLocation) {
        try {
          const parsed = JSON.parse(savedLastLocation);
          if (isValidWalkPoint(parsed)) {
            setCurrentLocation((prev) => prev ?? parsed);
          }
        } catch {}
      }

      await restoreActiveWalk();
    } catch {
      showAppDialog({
        title: "Не получилось загрузить данные",
        message: "Приложение продолжит работу. Открой профиль или настройки ещё раз позже.",
        variant: "error",
      });
    }
  }

  async function saveLastLocation(point: WalkPoint) {
    try {
      await AsyncStorage.setItem(
        STORAGE_LAST_LOCATION_KEY,
        JSON.stringify(point),
      );
    } catch {}
  }

  async function getInitialLocation() {
    // 1. Сначала проверяем сохранённую в кэше позицию с прошлого раза
    try {
      const cached = await AsyncStorage.getItem(STORAGE_LAST_LOCATION_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (isValidWalkPoint(parsed)) {
          setCurrentLocation((prev) => prev ?? parsed);
          moveMapTo(parsed);
        }
      }
    } catch {}

    const permission = await Location.requestForegroundPermissionsAsync();

    if (permission.status !== "granted") {
      return;
    }

    // 2. Мгновенно запрашиваем последнюю известную позицию из GPS-кэша системы (0мс задержка)
    try {
      const lastKnown = await Location.getLastKnownPositionAsync();
      if (lastKnown) {
        const point: WalkPoint = {
          latitude: lastKnown.coords.latitude,
          longitude: lastKnown.coords.longitude,
          timestamp: Date.now(),
        };
        setCurrentLocation(point);
        saveLastLocation(point);
        moveMapTo(point);
      }
    } catch {}

    // 3. Асинхронно уточняем точные свежие координаты
    try {
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const point: WalkPoint = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        timestamp: Date.now(),
      };

      setCurrentLocation(point);
      saveLastLocation(point);
      moveMapTo(point);
    } catch {}
  }

  function moveMapTo(point: WalkPoint) {
    cameraRef.current?.easeTo({
      center: [point.longitude, point.latitude],
      zoom: 15,
      duration: 700,
    });
  }

  async function saveCells(_cells: string[]) {
    // Radius-only mode does not add new grid cells, but legacy cells are kept
    // so updates do not wipe old guest-mode progress.
  }

  async function saveHistory(nextHistory: WalkHistoryItem[]) {
    await AsyncStorage.setItem(
      STORAGE_HISTORY_KEY,
      JSON.stringify(nextHistory),
    );
  }

  async function saveCoverageRoutes(nextCoverageRoutes: CoverageRoute[]) {
    try {
      await AsyncStorage.setItem(
        STORAGE_COVERAGE_ROUTES_KEY,
        JSON.stringify(nextCoverageRoutes),
      );
    } catch (e) {
      console.warn("Failed to save coverage routes to AsyncStorage", e);
    }
  }

  function isValidWalkPoint(point: any): point is WalkPoint {
    return (
      point &&
      typeof point.latitude === "number" &&
      typeof point.longitude === "number" &&
      typeof point.timestamp === "number" &&
      Number.isFinite(point.latitude) &&
      Number.isFinite(point.longitude)
    );
  }

  function thinCoveragePoints(routePoints: WalkPoint[]) {
    const cleanPoints = routePoints.filter(isValidWalkPoint);

    if (cleanPoints.length <= 2) {
      return cleanPoints.map((point) => ({
        latitude: Math.round(point.latitude * 1000000) / 1000000,
        longitude: Math.round(point.longitude * 1000000) / 1000000,
        timestamp: point.timestamp,
      }));
    }

    const thinned: WalkPoint[] = [
      {
        latitude: Math.round(cleanPoints[0].latitude * 1000000) / 1000000,
        longitude: Math.round(cleanPoints[0].longitude * 1000000) / 1000000,
        timestamp: cleanPoints[0].timestamp,
      },
    ];

    cleanPoints.slice(1, -1).forEach((point) => {
      const lastSavedPoint = thinned[thinned.length - 1];
      const distanceFromLast = getDistanceKm(lastSavedPoint, point);

      if (distanceFromLast >= 0.015) {
        thinned.push({
          latitude: Math.round(point.latitude * 1000000) / 1000000,
          longitude: Math.round(point.longitude * 1000000) / 1000000,
          timestamp: point.timestamp,
        });
      }
    });

    const lastPoint = cleanPoints[cleanPoints.length - 1];
    const previousPoint = thinned[thinned.length - 1];

    if (previousPoint.timestamp !== lastPoint.timestamp) {
      thinned.push({
        latitude: Math.round(lastPoint.latitude * 1000000) / 1000000,
        longitude: Math.round(lastPoint.longitude * 1000000) / 1000000,
        timestamp: lastPoint.timestamp,
      });
    }

    return thinned;
  }

  async function restoreActiveWalk() {
    const activeWalk = await readActiveWalkFromStorage();

    if (!activeWalk) {
      return;
    }

    setIsWalking(true);
    setStartedAt(activeWalk.startedAt);
    setDurationSec(Math.floor((Date.now() - activeWalk.startedAt) / 1000));
    setDistanceKm(activeWalk.distanceKm);
    pointsRef.current = [...activeWalk.points];
    setPoints(activeWalk.points);
    setCurrentWalkCells([]);
    distanceKmRef.current = activeWalk.distanceKm;

    // Restore background location service if it was killed by the system
    try {
      const hasStarted = await Location.hasStartedLocationUpdatesAsync(
        BACKGROUND_LOCATION_TASK,
      );

      if (!hasStarted) {
        const bgPerm = await Location.getBackgroundPermissionsAsync();

        if (bgPerm.status === "granted") {
          await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
            accuracy: Location.Accuracy.High,
            distanceInterval: 4,
            timeInterval: 3000,
            deferredUpdatesInterval: 5000,
            deferredUpdatesDistance: 5,
            foregroundService: {
              notificationTitle: "WalkMap отслеживает ваш путь",
              notificationBody: "Идёт запись прогулки в фоновом режиме...",
              notificationColor: "#35E6B7",
              killServiceOnDestroy: false,
            },
            pausesUpdatesAutomatically: false,
            showsBackgroundLocationIndicator: true,
          });
        }
      }

      setBackgroundRecordingEnabled(true);
    } catch {
      // Non-fatal: tracking data will still sync from storage
    }

    const lastPoint = activeWalk.points[activeWalk.points.length - 1];

    if (lastPoint) {
      setCurrentLocation(lastPoint);

      setTimeout(() => {
        moveMapTo(lastPoint);
      }, 700);
    }
  }

  async function syncActiveWalkFromStorage() {
    const activeWalk = await readActiveWalkFromStorage();

    if (!activeWalk) {
      return;
    }

    setStartedAt(activeWalk.startedAt);
    setDurationSec(Math.floor((Date.now() - activeWalk.startedAt) / 1000));
    setDistanceKm(activeWalk.distanceKm);
    pointsRef.current = [...activeWalk.points];
    setPoints(activeWalk.points);
    setCurrentWalkCells([]);
    distanceKmRef.current = activeWalk.distanceKm;

    const lastPoint = activeWalk.points[activeWalk.points.length - 1];

    if (lastPoint) {
      setCurrentLocation(lastPoint);
    }
  }

  async function stopBackgroundLocation() {
    const hasStarted = await Location.hasStartedLocationUpdatesAsync(
      BACKGROUND_LOCATION_TASK,
    );

    if (hasStarted) {
      await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    }

    setBackgroundRecordingEnabled(false);
  }

  async function refreshBackgroundRecordingStatus() {
    try {
      const hasStarted = await Location.hasStartedLocationUpdatesAsync(
        BACKGROUND_LOCATION_TASK,
      );

      setBackgroundRecordingEnabled(hasStarted);
    } catch {
      setBackgroundRecordingEnabled(false);
    }
  }

  function showBatteryHelp() {
    showAppDialog({
      title: "Фоновая запись",
      message:
        "Чтобы WalkMap стабильнее записывал прогулку с заблокированным экраном, разреши геолокацию в фоне и отключи ограничение батареи для приложения в настройках Android.",
      variant: "info",
      actions: [
        { text: "Позже", variant: "secondary" },
        {
          text: "Открыть настройки",
          variant: "primary",
          onPress: () => {
            Linking.openSettings();
          },
        },
      ],
    });
  }


  function getCellId(latitude: number, longitude: number) {
    const x = Math.floor(latitude / CELL_SIZE);
    const y = Math.floor(longitude / CELL_SIZE);

    return `${x}:${y}`;
  }

  function getCellPolygonCoordinates(cellId: string) {
    const parts = cellId.split(":");

    if (parts.length !== 2) return null;

    const x = Number(parts[0]);
    const y = Number(parts[1]);

    if (Number.isNaN(x) || Number.isNaN(y)) return null;

    const lat = x * CELL_SIZE;
    const lon = y * CELL_SIZE;

    return [
      [lon, lat],
      [lon, lat + CELL_SIZE],
      [lon + CELL_SIZE, lat + CELL_SIZE],
      [lon + CELL_SIZE, lat],
      [lon, lat],
    ];
  }

  function toRad(value: number) {
    return (value * Math.PI) / 180;
  }

  function getDistanceKm(a: WalkPoint, b: WalkPoint) {
    const R = 6371;
    const dLat = toRad(b.latitude - a.latitude);
    const dLon = toRad(b.longitude - a.longitude);

    const lat1 = toRad(a.latitude);
    const lat2 = toRad(b.latitude);

    const h =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

    return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  async function addWalkPoint(newPoint: WalkPoint) {
    setCurrentLocation(newPoint);
    saveLastLocation(newPoint);

    // Mutate pointsRef in-place to avoid GC pressure from spreading large arrays
    const lastPoint = pointsRef.current[pointsRef.current.length - 1];

    if (lastPoint) {
      const addedDistance = getDistanceKm(lastPoint, newPoint);

      if (addedDistance > 0.003 && addedDistance < 0.2) {
        distanceKmRef.current += addedDistance;
        setDistanceKm(distanceKmRef.current);
      }
    }

    pointsRef.current.push(newPoint);
    // Create a new array reference only when needed for React state / GeoJSON
    setPoints([...pointsRef.current]);

    const activeWalk = await readActiveWalkFromStorage();

    if (activeWalk) {
      addPointToActiveWalk(activeWalk, newPoint);
      activeWalk.currentWalkCells = [];
      distanceKmRef.current = activeWalk.distanceKm;
      setDistanceKm(activeWalk.distanceKm);
      await saveActiveWalkToStorage(activeWalk);
    }
  }

  async function startWalk() {
    const foregroundPermission = await Location.requestForegroundPermissionsAsync();

    if (foregroundPermission.status !== "granted") {
      showAppDialog({
        title: "Нет доступа",
        message: "Разреши доступ к геолокации, чтобы WalkMap мог записывать прогулку.",
        variant: "warning",
      });
      return;
    }

    const backgroundPermission = await Location.requestBackgroundPermissionsAsync();

    if (backgroundPermission.status !== "granted") {
      showAppDialog({
        title: "Нужна геолокация в фоне",
        message:
          "Чтобы WalkMap записывал прогулку с заблокированным экраном, разреши доступ к геолокации в фоне.",
        variant: "warning",
        actions: [
          { text: "Закрыть", variant: "secondary" },
          {
            text: "Настройки",
            variant: "primary",
            onPress: () => {
              Linking.openSettings();
            },
          },
        ],
      });
      return;
    }

    if (locationSubscription.current) {
      locationSubscription.current.remove();
      locationSubscription.current = null;
    }

    await stopBackgroundLocation();

    setIsWalking(true);
    const walkStartedAt = Date.now();
    setStartedAt(walkStartedAt);
    setDurationSec(0);
    setDistanceKm(0);
    pointsRef.current = [];
    setPoints([]);
    setCurrentWalkCells([]);
    distanceKmRef.current = 0;

    const firstLocation = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });

    const firstPoint: WalkPoint = {
      latitude: firstLocation.coords.latitude,
      longitude: firstLocation.coords.longitude,
      timestamp: firstLocation.timestamp || Date.now(),
    };

    const activeWalk: ActiveWalkData = {
      startedAt: walkStartedAt,
      points: [firstPoint],
      currentWalkCells: [],
      distanceKm: 0,
    };

    await saveActiveWalkToStorage(activeWalk);

    pointsRef.current = [...activeWalk.points];
    setPoints(activeWalk.points);
    setCurrentWalkCells([]);
    setCurrentLocation(firstPoint);
    moveMapTo(firstPoint);

    await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
      accuracy: Location.Accuracy.High,
      distanceInterval: 4,
      timeInterval: 3000,
      deferredUpdatesInterval: 5000,
      deferredUpdatesDistance: 5,
      foregroundService: {
        notificationTitle: "WalkMap отслеживает ваш путь",
        notificationBody: "Идёт запись прогулки в фоновом режиме...",
        notificationColor: "#35E6B7",
        killServiceOnDestroy: false,
      },
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
    });

    setBackgroundRecordingEnabled(true);

    showAppDialog({
      title: "Прогулка началась",
      message:
        "Телефон можно заблокировать. Если запись будет прерываться, открой настройки приложения и отключи ограничение батареи для WalkMap.",
      variant: "success",
      actions: [
        { text: "Ок", variant: "secondary" },
        {
          text: "Настройки",
          variant: "primary",
          onPress: () => {
            Linking.openSettings();
          },
        },
      ],
    });
  }

  function askFinishWalk() {
    const safeDuration = startedAt
      ? Math.floor((Date.now() - startedAt) / 1000)
      : durationSec;

    if (safeDuration < 20 && distanceKmRef.current < 0.02) {
      setFinishConfirmMode("short");
      setFinishConfirmVisible(true);
      return;
    }

    setFinishConfirmMode("normal");
    setFinishConfirmVisible(true);
  }

  function confirmFinishWalk() {
    setFinishConfirmVisible(false);
    finishWalk();
  }

  async function cancelWalk() {
    setFinishConfirmVisible(false);

    if (locationSubscription.current) {
      locationSubscription.current.remove();
      locationSubscription.current = null;
    }

    await stopBackgroundLocation();
    await AsyncStorage.removeItem(STORAGE_ACTIVE_WALK_KEY);

    setIsWalking(false);
    setStartedAt(null);
    setDurationSec(0);
    setDistanceKm(0);
    pointsRef.current = [];
    setPoints([]);
    setCurrentWalkCells([]);
    distanceKmRef.current = 0;
  }

  async function finishWalk() {
    if (locationSubscription.current) {
      locationSubscription.current.remove();
      locationSubscription.current = null;
    }

    const activeWalk = await readActiveWalkFromStorage();

    await stopBackgroundLocation();
    await AsyncStorage.removeItem(STORAGE_ACTIVE_WALK_KEY);

    const finishStartedAt = activeWalk?.startedAt ?? startedAt;
    const finishDurationSec = finishStartedAt
      ? Math.floor((Date.now() - finishStartedAt) / 1000)
      : durationSec;

    const finishPoints =
      activeWalk && activeWalk.points.length > 0 ? activeWalk.points : points;
    const finishDistanceKm = activeWalk?.distanceKm ?? distanceKmRef.current;

    const previousStats = getProgressStats([], history);
    const nextHistoryBase: WalkHistoryItem = {
      id: Date.now().toString(),
      date: formatRussianDate(),
      dayKey: getTodayKey(),
      distanceKm: finishDistanceKm,
      durationSec: finishDurationSec,
      newCells: 0,
      totalCells: undefined,
    };

    const nextStats = getProgressStats([], [
      nextHistoryBase,
      ...history,
    ]);

    const unlockedNow = getNewAchievements(previousStats, nextStats);

    const walkItem: WalkHistoryItem = {
      ...nextHistoryBase,
      achievementsUnlocked: unlockedNow.map((achievement) => achievement.id),
    };

    const nextHistory = [walkItem, ...history];
    const nextCoverageRoutes =
      finishPoints.length > 0
        ? [
            {
              id: walkItem.id,
              points: thinCoveragePoints(finishPoints),
            },
            ...coverageRoutes,
          ].slice(0, MAX_COVERAGE_ROUTES_ON_MAP)
        : coverageRoutes;

    setOpenedCells([]);
    setCoverageRoutes(nextCoverageRoutes);
    setHistory(nextHistory);
    setLastResult(walkItem);
    setResultModalVisible(true);
    setDurationSec(finishDurationSec);
    setDistanceKm(finishDistanceKm);
    pointsRef.current = [...finishPoints];
    setPoints(finishPoints);
    setCurrentWalkCells([]);
    distanceKmRef.current = finishDistanceKm;

    await saveCells([]);
    await saveCoverageRoutes(nextCoverageRoutes);
    await saveHistory(nextHistory);

    setIsWalking(false);
    setStartedAt(null);
  }

  function askResetData() {
    showAppDialog({
      title: "Сбросить весь прогресс?",
      message:
        "Будут удалены прогулки, история и открытая территория. Ник и цвет останутся сохранёнными.",
      variant: "danger",
      actions: [
        { text: "Отмена", variant: "secondary" },
        {
          text: "Сбросить",
          variant: "danger",
          onPress: resetData,
        },
      ],
    });
  }

  function askResetApplication() {
    showAppDialog({
      title: "Сбросить всё приложение?",
      message:
        "Будут удалены прогулки, история, открытая территория, ник и выбранный цвет.",
      variant: "danger",
      actions: [
        { text: "Отмена", variant: "secondary" },
        {
          text: "Сбросить всё",
          variant: "danger",
          onPress: resetApplication,
        },
      ],
    });
  }

  async function resetData() {
    if (locationSubscription.current) {
      locationSubscription.current.remove();
      locationSubscription.current = null;
    }

    await stopBackgroundLocation();

    await AsyncStorage.removeItem(STORAGE_CELLS_KEY);
    await AsyncStorage.removeItem(STORAGE_HISTORY_KEY);
    await AsyncStorage.removeItem(STORAGE_ACTIVE_WALK_KEY);
    await AsyncStorage.removeItem(STORAGE_COVERAGE_ROUTES_KEY);

    setIsWalking(false);
    setStartedAt(null);
    setOpenedCells([]);
    setCurrentWalkCells([]);
    setCoverageRoutes([]);
    setHistory([]);
    pointsRef.current = [];
    setPoints([]);
    setDistanceKm(0);
    setDurationSec(0);
    setLastResult(null);
    distanceKmRef.current = 0;
  }

  async function resetApplication() {
    await resetData();
    await AsyncStorage.removeItem(STORAGE_LOCAL_PROFILE_KEY);
    await AsyncStorage.removeItem(STORAGE_ACCENT_COLOR_KEY);

    const defaultAccent = ACCENT_THEMES[0].id;
    setAccentThemeId(defaultAccent);
    setLocalProfile(null);
    setNicknameDraft("");
    setProfileReady(true);
  }

  function getTodayKey() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
      2,
      "0",
    )}-${String(now.getDate()).padStart(2, "0")}`;
  }

  function getDayKeyFromHistoryItem(item: WalkHistoryItem) {
    if (item.dayKey) return item.dayKey;

    const match = item.date.match(/(\d{2})\.(\d{2})\.(\d{4})/);

    if (!match) return "";

    return `${match[3]}-${match[2]}-${match[1]}`;
  }

  function getYesterdayKey(dayKey: string) {
    const date = new Date(`${dayKey}T12:00:00`);
    date.setDate(date.getDate() - 1);

    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
      2,
      "0",
    )}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function getStreak(items: WalkHistoryItem[]) {
    const walkedDays = Array.from(
      new Set(items.map(getDayKeyFromHistoryItem).filter(Boolean)),
    ).sort();

    if (walkedDays.length === 0) return 0;

    let streak = 0;
    let cursor = getTodayKey();

    // If the user hasn't walked today, start counting from yesterday
    if (!walkedDays.includes(cursor)) {
      cursor = getYesterdayKey(cursor);
    }

    while (walkedDays.includes(cursor)) {
      streak += 1;
      cursor = getYesterdayKey(cursor);
    }

    return streak;
  }

  function getLevelInfo(totalDistanceKm: number): LevelInfo {
    let current = LEVELS[0];
    let next = LEVELS[LEVELS.length - 1];

    for (let index = 0; index < LEVELS.length; index += 1) {
      if (totalDistanceKm >= LEVELS[index].km) {
        current = LEVELS[index];
      }

      if (totalDistanceKm < LEVELS[index].km) {
        next = LEVELS[index];
        break;
      }
    }

    const currentTarget = current.km;
    const nextTarget = next.km;
    const isMaxLevel = current.level === LEVELS[LEVELS.length - 1].level;
    const progressPercent = isMaxLevel
      ? 100
      : Math.min(
          100,
          Math.round(
            ((totalDistanceKm - currentTarget) /
              Math.max(0.1, nextTarget - currentTarget)) *
              100,
          ),
        );

    return {
      level: current.level,
      title: current.title,
      currentCells: Math.round(totalDistanceKm * 10) / 10,
      currentTarget,
      nextTarget,
      progressPercent,
      cellsToNextLevel: isMaxLevel
        ? 0
        : Math.max(0, Math.round((nextTarget - totalDistanceKm) * 10) / 10),
    };
  }

  function getDailyProgress(items: WalkHistoryItem[]): DailyProgress {
    const todayKey = getTodayKey();
    const todayItems = items.filter(
      (item) => getDayKeyFromHistoryItem(item) === todayKey,
    );

    const todayDistance = todayItems.reduce(
      (sum, item) => sum + (Number(item.distanceKm) || 0),
      0,
    );

    const todayDuration = todayItems.reduce(
      (sum, item) => sum + (Number(item.durationSec) || 0),
      0,
    );

    return {
      dayKey: todayKey,
      distanceKm: todayDistance,
      durationSec: todayDuration,
      newCells: 0,
      walks: todayItems.length,
      cellsGoalPercent: 0,
      distanceGoalPercent: Math.min(
        100,
        Math.round((todayDistance / DAILY_DISTANCE_GOAL_KM) * 100),
      ),
      isGoalDone: todayDistance >= DAILY_DISTANCE_GOAL_KM,
    };
  }

  function getProgressStats(cells: string[], items: WalkHistoryItem[]) {
    const totalDistance = items.reduce(
      (sum, item) => sum + (Number(item.distanceKm) || 0),
      0,
    );

    const totalDuration = items.reduce(
      (sum, item) => sum + (Number(item.durationSec) || 0),
      0,
    );

    const longestWalkKm = items.reduce(
      (max, item) => Math.max(max, Number(item.distanceKm) || 0),
      0,
    );

    const longestWalkSec = items.reduce(
      (max, item) => Math.max(max, Number(item.durationSec) || 0),
      0,
    );

    return {
      totalWalks: items.length,
      totalDistanceKm: totalDistance,
      totalDurationSec: totalDuration,
      openedCellsCount: 0,
      longestWalkKm,
      longestWalkSec,
      bestCellsWalk: 0,
      streak: getStreak(items),
      levelInfo: getLevelInfo(totalDistance),
      dailyProgress: getDailyProgress(items),
    };
  }

  function getAchievements(stats: ReturnType<typeof getProgressStats>) {
    const achievements: Achievement[] = [
      {
        id: "first_walk",
        title: "Первый след",
        description: "Заверши первую прогулку",
        isUnlocked: stats.totalWalks >= 1,
      },
      {
        id: "one_km_total",
        title: "Первый километр",
        description: "Пройди 1 км суммарно",
        isUnlocked: stats.totalDistanceKm >= 1,
      },
      {
        id: "five_km_total",
        title: "Уже райончик",
        description: "Пройди 5 км суммарно",
        isUnlocked: stats.totalDistanceKm >= 5,
      },
      {
        id: "five_walks",
        title: "Маршрут вошёл в привычку",
        description: "Заверши 5 прогулок",
        isUnlocked: stats.totalWalks >= 5,
      },
      {
        id: "ten_km_total",
        title: "Город начал открываться",
        description: "Пройди 10 км суммарно",
        isUnlocked: stats.totalDistanceKm >= 10,
      },
      {
        id: "twenty_minutes",
        title: "Нормальная прогулка",
        description: "Заверши прогулку на 20+ минут",
        isUnlocked: stats.longestWalkSec >= 20 * 60,
      },
      {
        id: "daily_goal",
        title: "Цель дня",
        description: "Выполни дневную цель",
        isUnlocked: stats.dailyProgress.isGoalDone,
      },
      {
        id: "three_day_streak",
        title: "Серия началась",
        description: "Гуляй 3 дня подряд",
        isUnlocked: stats.streak >= 3,
      },
    ];

    return achievements;
  }

  function getNewAchievements(
    previousStats: ReturnType<typeof getProgressStats>,
    nextStats: ReturnType<typeof getProgressStats>,
  ) {
    const previousUnlockedIds = getAchievements(previousStats)
      .filter((achievement) => achievement.isUnlocked)
      .map((achievement) => achievement.id);

    return getAchievements(nextStats).filter(
      (achievement) =>
        achievement.isUnlocked && !previousUnlockedIds.includes(achievement.id),
    );
  }

  function getAchievementById(id: string) {
    return achievements.find((achievement) => achievement.id === id);
  }

  function formatTime(seconds: number) {
    const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = Math.floor(safeSeconds / 3600);
    const mins = Math.floor((safeSeconds % 3600) / 60);
    const secs = safeSeconds % 60;

    if (hours > 0) {
      return `${hours}:${mins.toString().padStart(2, "0")}:${secs
        .toString()
        .padStart(2, "0")}`;
    }

    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }

  function formatKm(value: number) {
    const safe = Number(value) || 0;
    return safe.toFixed(2).replace(".", ",");
  }

  function formatArea(value: number) {
    const safe = Number(value) || 0;
    if (safe < 1) {
      return `${Math.round(safe * 1_000_000)} м²`;
    }

    return `${safe.toFixed(2).replace(".", ",")} км²`;
  }

  function formatSpeed(distKm: number, durSec: number) {
    const safeDistKm = Number(distKm) || 0;
    const safeDurSec = Number(durSec) || 0;
    if (safeDurSec < 1) return "—";
    const kmh = (safeDistKm / safeDurSec) * 3600;
    return `${kmh.toFixed(1).replace(".", ",")}`;
  }

  function getCellGridCoords(cellId: string) {
    const parts = cellId.split(":");

    if (parts.length !== 2) return null;

    const x = Number(parts[0]);
    const y = Number(parts[1]);

    if (Number.isNaN(x) || Number.isNaN(y)) return null;

    return { x, y };
  }

  function makeCoverageRoutesLineGeoJson(routes: CoverageRoute[]): MapGeoJsonData {
    return {
      type: "FeatureCollection",
      features: routes
        .slice(0, 500)
        .map((route, index) => {
          const cleanPoints = route.points.filter(isValidWalkPoint);

          if (cleanPoints.length < 2) {
            return null;
          }

          return {
            type: "Feature" as const,
            id: route.id || index,
            properties: {},
            geometry: {
              type: "LineString" as const,
              coordinates: cleanPoints.map((point) => [
                point.longitude,
                point.latitude,
              ]),
            },
          };
        })
        .filter(Boolean),
    };
  }

  function pointToMercatorMeters(point: WalkPoint) {
    const latitude = Math.max(-85, Math.min(85, point.latitude));
    const longitude = Math.max(-180, Math.min(180, point.longitude));
    const lonRad = toRad(longitude);
    const latRad = toRad(latitude);

    return {
      x: WEB_MERCATOR_RADIUS_METERS * lonRad,
      y:
        WEB_MERCATOR_RADIUS_METERS *
        Math.log(Math.tan(Math.PI / 4 + latRad / 2)),
    };
  }

  function mercatorMetersToCoordinate(x: number, y: number): [number, number] {
    const longitude = (x / WEB_MERCATOR_RADIUS_METERS) * (180 / Math.PI);
    const latitude =
      (2 * Math.atan(Math.exp(y / WEB_MERCATOR_RADIUS_METERS)) - Math.PI / 2) *
      (180 / Math.PI);

    return [longitude, latitude];
  }

  type MercatorPoint = {
    x: number;
    y: number;
  };

  function getRingSignedArea(ring: [number, number][]) {
    let sum = 0;

    for (let index = 0; index < ring.length - 1; index += 1) {
      const current = ring[index];
      const next = ring[index + 1];
      sum += current[0] * next[1] - next[0] * current[1];
    }

    return sum / 2;
  }

  function getMercatorRingArea(ring: MercatorPoint[]) {
    let sum = 0;

    for (let index = 0; index < ring.length; index += 1) {
      const current = ring[index];
      const next = ring[(index + 1) % ring.length];
      sum += current.x * next.y - next.x * current.y;
    }

    return sum / 2;
  }

  function makeCircleRing(
    point: WalkPoint,
    radiusMeters = UNLOCK_RADIUS_METERS,
    steps = 96,
  ): [number, number][] {
    const center = pointToMercatorMeters(point);
    const ring: [number, number][] = [];

    for (let index = 0; index <= steps; index += 1) {
      const angle = (Math.PI * 2 * index) / steps;
      const x = center.x + Math.cos(angle) * radiusMeters;
      const y = center.y + Math.sin(angle) * radiusMeters;
      ring.push(mercatorMetersToCoordinate(x, y));
    }

    return ring;
  }

  function addCoverageSample(
    samples: MercatorPoint[],
    seen: Set<string>,
    point: MercatorPoint,
  ) {
    const key = `${Math.round(point.x / COVERAGE_SAMPLE_STEP_METERS)}:${Math.round(
      point.y / COVERAGE_SAMPLE_STEP_METERS,
    )}`;

    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    samples.push(point);
  }

  function addRouteCoverageSamples(
    samples: MercatorPoint[],
    seen: Set<string>,
    routePoints: WalkPoint[],
  ) {
    const cleanPoints = routePoints.filter(isValidWalkPoint);

    if (cleanPoints.length === 0) {
      return;
    }

    if (cleanPoints.length === 1) {
      addCoverageSample(samples, seen, pointToMercatorMeters(cleanPoints[0]));
      return;
    }

    for (let index = 0; index < cleanPoints.length - 1; index += 1) {
      const start = pointToMercatorMeters(cleanPoints[index]);
      const end = pointToMercatorMeters(cleanPoints[index + 1]);
      const segmentDistance = Math.hypot(end.x - start.x, end.y - start.y);
      const steps = Math.max(
        1,
        Math.ceil(segmentDistance / COVERAGE_SAMPLE_STEP_METERS),
      );

      for (let step = 0; step <= steps; step += 1) {
        const progress = step / steps;
        addCoverageSample(samples, seen, {
          x: start.x + (end.x - start.x) * progress,
          y: start.y + (end.y - start.y) * progress,
        });
      }
    }
  }

  function collectCoverageSamples(
    routes: CoverageRoute[],
    routePoints: WalkPoint[],
    fallbackPoint: WalkPoint | null,
  ) {
    const samples: MercatorPoint[] = [];
    const seen = new Set<string>();

    routes.slice(0, MAX_COVERAGE_ROUTES_ON_MAP).forEach((route) => {
      addRouteCoverageSamples(samples, seen, route.points);
    });

    addRouteCoverageSamples(samples, seen, routePoints);

    if (fallbackPoint) {
      addCoverageSample(samples, seen, pointToMercatorMeters(fallbackPoint));
    }

    if (samples.length <= MAX_COVERAGE_SAMPLE_POINTS) {
      return samples;
    }

    const subsampleStep = Math.ceil(samples.length / MAX_COVERAGE_SAMPLE_POINTS);
    return samples.filter((_, idx) => idx % subsampleStep === 0);
  }

  function makeAnglePositive(angle: number) {
    const full = Math.PI * 2;
    let result = angle % full;

    if (result < 0) {
      result += full;
    }

    return result;
  }

  function makeCirclePoint(center: MercatorPoint, angle: number) {
    return {
      x: center.x + Math.cos(angle) * UNLOCK_RADIUS_METERS,
      y: center.y + Math.sin(angle) * UNLOCK_RADIUS_METERS,
    };
  }

  function getUnionBucketKey(x: number, y: number, bucketSize: number) {
    return `${Math.floor(x / bucketSize)}:${Math.floor(y / bucketSize)}`;
  }

  function makeCircleUnionBuckets(samples: MercatorPoint[], bucketSize: number) {
    const buckets = new globalThis.Map<string, number[]>();

    samples.forEach((sample, index) => {
      const key = getUnionBucketKey(sample.x, sample.y, bucketSize);
      const list = buckets.get(key) ?? [];
      list.push(index);
      buckets.set(key, list);
    });

    return buckets;
  }

  function getNearbyCircleIndexes(
    sample: MercatorPoint,
    buckets: globalThis.Map<string, number[]>,
    bucketSize: number,
  ) {
    const bucketX = Math.floor(sample.x / bucketSize);
    const bucketY = Math.floor(sample.y / bucketSize);
    const result: number[] = [];

    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const list = buckets.get(`${bucketX + dx}:${bucketY + dy}`);

        if (list) {
          result.push(...list);
        }
      }
    }

    return result;
  }

  function addCoveredAngleInterval(
    intervals: { start: number; end: number }[],
    start: number,
    end: number,
  ) {
    const full = Math.PI * 2;
    const safeStart = makeAnglePositive(start);
    const safeEnd = makeAnglePositive(end);

    if (end - start >= full) {
      intervals.push({ start: 0, end: full });
      return;
    }

    if (safeStart <= safeEnd) {
      intervals.push({ start: safeStart, end: safeEnd });
      return;
    }

    intervals.push({ start: safeStart, end: full });
    intervals.push({ start: 0, end: safeEnd });
  }

  function mergeAngleIntervals(intervals: { start: number; end: number }[]) {
    const sortedIntervals = intervals
      .filter((interval) => interval.end - interval.start > 0.0001)
      .sort((a, b) => a.start - b.start);

    if (sortedIntervals.length === 0) {
      return [];
    }

    const merged: { start: number; end: number }[] = [sortedIntervals[0]];

    sortedIntervals.slice(1).forEach((interval) => {
      const last = merged[merged.length - 1];

      if (interval.start <= last.end + 0.0001) {
        last.end = Math.max(last.end, interval.end);
      } else {
        merged.push({ ...interval });
      }
    });

    return merged;
  }

  function getUncoveredAngleIntervals(coveredIntervals: { start: number; end: number }[]) {
    const full = Math.PI * 2;
    const merged = mergeAngleIntervals(coveredIntervals);

    if (merged.length === 0) {
      return [{ start: 0, end: full }];
    }

    if (merged.length === 1 && merged[0].start <= 0 && merged[0].end >= full) {
      return [];
    }

    const uncovered: { start: number; end: number }[] = [];
    let cursor = 0;

    merged.forEach((interval) => {
      if (interval.start > cursor + 0.0001) {
        uncovered.push({ start: cursor, end: interval.start });
      }

      cursor = Math.max(cursor, interval.end);
    });

    if (cursor < full - 0.0001) {
      uncovered.push({ start: cursor, end: full });
    }

    return uncovered;
  }

  function makeArcPoints(center: MercatorPoint, startAngle: number, endAngle: number) {
    const angleLength = endAngle - startAngle;
    const arcLength = Math.max(0, angleLength * UNLOCK_RADIUS_METERS);
    const steps = Math.max(3, Math.ceil(arcLength / 4));
    const points: MercatorPoint[] = [];

    for (let step = 0; step <= steps; step += 1) {
      const progress = step / steps;
      const angle = startAngle + angleLength * progress;
      points.push(makeCirclePoint(center, angle));
    }

    return points;
  }

  function getMercatorPointKey(point: MercatorPoint) {
    return `${Math.round(point.x * 5)}:${Math.round(point.y * 5)}`;
  }

  function findNearestArcIndex(
    keyPoint: MercatorPoint,
    segments: { points: MercatorPoint[]; used: boolean }[],
  ) {
    let bestIndex = -1;
    let bestDistance = 1.5;

    segments.forEach((segment, index) => {
      if (segment.used) {
        return;
      }

      const start = segment.points[0];
      const distance = Math.hypot(start.x - keyPoint.x, start.y - keyPoint.y);

      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });

    return bestIndex;
  }

  function buildRingsFromCircleArcs(
    segments: { points: MercatorPoint[]; used: boolean }[],
  ) {
    const startsByKey = new globalThis.Map<string, number[]>();

    segments.forEach((segment, index) => {
      const key = getMercatorPointKey(segment.points[0]);
      const list = startsByKey.get(key) ?? [];
      list.push(index);
      startsByKey.set(key, list);
    });

    const takeSegmentByStartKey = (key: string) => {
      const list = startsByKey.get(key);

      if (!list || list.length === 0) {
        return -1;
      }

      while (list.length > 0) {
        const index = list.shift() as number;

        if (!segments[index].used) {
          if (list.length === 0) {
            startsByKey.delete(key);
          } else {
            startsByKey.set(key, list);
          }

          return index;
        }
      }

      startsByKey.delete(key);
      return -1;
    };

    const rings: [number, number][][] = [];

    segments.forEach((segment, startIndex) => {
      if (segment.used) {
        return;
      }

      segment.used = true;
      const ring = [...segment.points];
      const firstPoint = ring[0];
      let guard = 0;

      while (guard < 20_000) {
        const endPoint = ring[ring.length - 1];

        if (Math.hypot(endPoint.x - firstPoint.x, endPoint.y - firstPoint.y) < 1.5) {
          break;
        }

        const nextKey = getMercatorPointKey(endPoint);
        let nextIndex = takeSegmentByStartKey(nextKey);

        if (nextIndex < 0) {
          nextIndex = findNearestArcIndex(endPoint, segments);
        }

        if (nextIndex < 0) {
          break;
        }

        segments[nextIndex].used = true;
        ring.push(...segments[nextIndex].points.slice(1));
        guard += 1;
      }

      const endPoint = ring[ring.length - 1];

      if (Math.hypot(endPoint.x - firstPoint.x, endPoint.y - firstPoint.y) >= 2) {
        segments[startIndex].used = true;
        return;
      }

      if (ring.length < 8) {
        return;
      }

      const area = Math.abs(getMercatorRingArea(ring));

      if (area < UNLOCK_RADIUS_METERS * UNLOCK_RADIUS_METERS * 0.2) {
        return;
      }

      const coordinates = ring.map((point) => mercatorMetersToCoordinate(point.x, point.y));
      coordinates.push(coordinates[0]);

      const signedArea = getRingSignedArea(coordinates);
      rings.push(signedArea > 0 ? [...coordinates].reverse() : coordinates);
    });

    return rings;
  }

  function makeOpenedRadiusRings(
    routes: CoverageRoute[],
    routePoints: WalkPoint[],
    fallbackPoint: WalkPoint | null,
  ) {
    const samples = collectCoverageSamples(routes, routePoints, fallbackPoint);

    if (samples.length === 0) {
      return [];
    }

    const bucketSize = UNLOCK_RADIUS_METERS * 2;
    const buckets = makeCircleUnionBuckets(samples, bucketSize);
    const arcSegments: { points: MercatorPoint[]; used: boolean }[] = [];
    const full = Math.PI * 2;

    samples.forEach((sample, sampleIndex) => {
      const coveredIntervals: { start: number; end: number }[] = [];
      const nearbyIndexes = getNearbyCircleIndexes(sample, buckets, bucketSize);

      nearbyIndexes.forEach((nearbyIndex) => {
        if (nearbyIndex === sampleIndex) {
          return;
        }

        const other = samples[nearbyIndex];
        const distance = Math.hypot(other.x - sample.x, other.y - sample.y);

        if (distance < 0.01) {
          coveredIntervals.push({ start: 0, end: full });
          return;
        }

        if (distance >= UNLOCK_RADIUS_METERS * 2) {
          return;
        }

        const angle = Math.atan2(other.y - sample.y, other.x - sample.x);
        const halfAngle = Math.acos(
          Math.max(-1, Math.min(1, distance / (UNLOCK_RADIUS_METERS * 2))),
        );

        addCoveredAngleInterval(coveredIntervals, angle - halfAngle, angle + halfAngle);
      });

      const uncoveredIntervals = getUncoveredAngleIntervals(coveredIntervals);

      uncoveredIntervals.forEach((interval) => {
        if (interval.end - interval.start >= full - 0.0001) {
          const circlePoints = makeArcPoints(sample, 0, full);
          const coordinates = circlePoints.map((point) =>
            mercatorMetersToCoordinate(point.x, point.y),
          );
          coordinates.push(coordinates[0]);
          const signedArea = getRingSignedArea(coordinates);
          arcSegments.push({ points: circlePoints, used: true });
          const ring = signedArea > 0 ? [...coordinates].reverse() : coordinates;
          // Store isolated circles directly by abusing a marker segment that is already used.
          (arcSegments as any).__isolatedRings = [
            ...((arcSegments as any).__isolatedRings ?? []),
            ring,
          ];
          return;
        }

        const arcPoints = makeArcPoints(sample, interval.start, interval.end);

        if (arcPoints.length >= 2) {
          arcSegments.push({ points: arcPoints, used: false });
        }
      });
    });

    const isolatedRings = ((arcSegments as any).__isolatedRings ?? []) as [
      number,
      number,
    ][][];

    return [...isolatedRings, ...buildRingsFromCircleArcs(arcSegments)];
  }

  function makeFogGeoJson(openedRings: [number, number][][]): MapGeoJsonData {
    return {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature" as const,
          properties: {},
          geometry: {
            type: "Polygon" as const,
            coordinates: [FOG_OUTER_RING, ...openedRings],
          },
        },
      ],
    };
  }

  function makeOpenedEdgeGeoJson(openedRings: [number, number][][]): MapGeoJsonData {
    return {
      type: "FeatureCollection",
      features: openedRings.map((ring, index) => ({
        type: "Feature" as const,
        id: index,
        properties: {},
        geometry: {
          type: "LineString" as const,
          coordinates: ring,
        },
      })),
    };
  }

  function makeUserRadiusGeoJson(point: WalkPoint | null): MapGeoJsonData {
    return {
      type: "FeatureCollection",
      features: point
        ? [
            {
              type: "Feature" as const,
              properties: {},
              geometry: {
              type: "Polygon" as const,
                coordinates: [makeCircleRing(point, UNLOCK_RADIUS_METERS, USER_RADIUS_RING_STEPS)],
              },
            },
          ]
        : [],
    };
  }

  const newCellsNow = 0;

  // Memoize all stats computations — only recompute when history changes
  const totalDistanceKm = useMemo(() => history.reduce(
    (sum, item) => sum + (Number(item.distanceKm) || 0),
    0,
  ), [history]);

  const totalDurationSec = useMemo(() => history.reduce(
    (sum, item) => sum + (Number(item.durationSec) || 0),
    0,
  ), [history]);

  const longestWalkKm = useMemo(() => history.reduce(
    (max, item) => Math.max(max, Number(item.distanceKm) || 0),
    0,
  ), [history]);

  const openedAreaKm2 = useMemo(() => Math.max(
    0,
    totalDistanceKm * ((UNLOCK_RADIUS_METERS * 2) / 1000),
  ), [totalDistanceKm]);

  const progressStats = useMemo(() => getProgressStats(EMPTY_STRINGS, history), [history]);
  const levelInfo = progressStats.levelInfo;
  const dailyProgress = progressStats.dailyProgress;
  const achievements = useMemo(() => getAchievements(progressStats), [progressStats]);
  const unlockedAchievements = useMemo(() => achievements.filter(
    (achievement) => achievement.isUnlocked,
  ), [achievements]);
  const lastUnlockedAchievements = useMemo(() =>
    lastResult?.achievementsUnlocked
      ?.map(getAchievementById)
      .filter(Boolean) as Achievement[] | undefined,
  [lastResult]);

  // Stable reference: empty array when not walking, avoids fog recompute
  const displayRoutePoints = useMemo(
    () => (isWalking ? points : EMPTY_POINTS),
    [isWalking, points],
  );

  // Use debouncedLocation for expensive fog computation (3s debounce)
  const openedBoundaryRings = useMemo(() => {
    return makeOpenedRadiusRings(
      coverageRoutes,
      displayRoutePoints,
      debouncedLocation,
    );
  }, [coverageRoutes, displayRoutePoints, debouncedLocation]);

  const fogGeoJson = useMemo(() => {
    return makeFogGeoJson(openedBoundaryRings);
  }, [openedBoundaryRings]);

  const openedEdgeGeoJson = useMemo(() => {
    return makeOpenedEdgeGeoJson(openedBoundaryRings);
  }, [openedBoundaryRings]);

  const userRadiusGeoJson = useMemo(() => {
    return makeUserRadiusGeoJson(currentLocation);
  }, [currentLocation]);

  const routeGeoJson: MapGeoJsonData = useMemo(() => {
    return {
      type: "FeatureCollection",
      features:
        points.length > 1
          ? [
              {
                type: "Feature",
                properties: {},
                geometry: {
                  type: "LineString",
                  coordinates: points.map((point) => [
                    point.longitude,
                    point.latitude,
                  ]),
                },
              },
            ]
          : [],
    };
  }, [points]);

  const userGeoJson: MapGeoJsonData = useMemo(() => {
    return {
      type: "FeatureCollection",
      features: currentLocation
        ? [
            {
              type: "Feature",
              properties: {},
              geometry: {
                type: "Point",
                coordinates: [
                  currentLocation.longitude,
                  currentLocation.latitude,
                ],
              },
            },
          ]
        : [],
    };
  }, [currentLocation]);


  if (!profileReady) {
    return (
      <View style={styles.authScreen}>
        <StatusBar barStyle="light-content" />
        <ActivityIndicator size="large" color={accentTheme.color} />
        <Text style={styles.authLoadingText}>Загрузка профиля...</Text>
      </View>
    );
  }

  if (!localProfile) {
    return (
      <KeyboardAvoidingView
        style={styles.authScreen}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <StatusBar barStyle="light-content" />

        <View style={styles.authCard}>
          <Text style={[styles.authLogo, { color: accentTheme.color }]}>WalkMap</Text>
          <Text style={styles.authTitle}>Как тебя называть?</Text>
          <Text style={styles.authSubtitle}>
            Ник сохранится на этом устройстве. Интернет не нужен.
          </Text>

          <TextInput
            style={styles.authInput}
            value={nicknameDraft}
            onChangeText={handleNicknameDraftChange}
            placeholder="Гость"
            placeholderTextColor="#6F7A99"
            maxLength={220}
            autoCapitalize="sentences"
          />

          <TouchableOpacity
            style={[
              styles.authPrimaryButton,
              { backgroundColor: accentTheme.color },
              nicknameBusy && styles.disabledButton,
            ]}
            onPress={handleCreateLocalProfile}
            disabled={nicknameBusy}
          >
            <Text style={[styles.buttonText, { color: accentTheme.foreground }]}>
              {nicknameBusy ? "Сохраняю..." : "Начать"}
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    );
  }

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="light-content" />

      <Map
        style={styles.map}
        mapStyle={MAP_STYLE}
        onDidFinishLoadingMap={() => setMapReady(true)}
        compass={false}
        logo={false}
        attribution={true}
      >
        <Camera
          ref={cameraRef}
          initialViewState={{
            center: currentLocation
              ? [currentLocation.longitude, currentLocation.latitude]
              : DEFAULT_CENTER,
            zoom: 15,
          }}
        />

        <GeoJSONSource id="fog-source" data={fogGeoJson as any}>
          <Layer
            id="locked-map-fog"
            type="fill"
            paint={{
              "fill-color": "#101622",
              "fill-opacity": 0.72,
            }}
          />
        </GeoJSONSource>

        <GeoJSONSource id="opened-edge-source" data={openedEdgeGeoJson as any}>
          <Layer
            id="opened-territory-edge"
            type="line"
            layout={{
              "line-cap": "round",
              "line-join": "round",
            }}
            paint={{
              "line-color": accentTheme.color,
              "line-width": 2,
              "line-opacity": 0.74,
            }}
          />
        </GeoJSONSource>

        <GeoJSONSource id="user-radius-source" data={userRadiusGeoJson as any}>
          <Layer
            id="user-radius-halo"
            type="line"
            layout={{
              "line-cap": "round",
              "line-join": "round",
            }}
            paint={{
              "line-color": accentTheme.color,
              "line-width": 18,
              "line-opacity": 0.18,
              "line-blur": 10,
            }}
          />
          <Layer
            id="user-radius-fill"
            type="fill"
            paint={{
              "fill-color": accentTheme.color,
              "fill-opacity": 0.11,
              "fill-antialias": true,
            }}
          />
          <Layer
            id="user-radius-soft-edge"
            type="line"
            layout={{
              "line-cap": "round",
              "line-join": "round",
            }}
            paint={{
              "line-color": accentTheme.color,
              "line-width": 7,
              "line-opacity": 0.22,
              "line-blur": 3,
            }}
          />
          <Layer
            id="user-radius-edge"
            type="line"
            layout={{
              "line-cap": "round",
              "line-join": "round",
            }}
            paint={{
              "line-color": accentTheme.color,
              "line-width": 2.2,
              "line-opacity": 0.92,
            }}
          />
        </GeoJSONSource>

        <GeoJSONSource id="route-source" data={routeGeoJson as any}>
          <Layer
            id="route-line"
            type="line"
            paint={{
              "line-color": "#FFFFFF",
              "line-width": 4,
              "line-opacity": 0.72,
            }}
          />
        </GeoJSONSource>

        <GeoJSONSource id="user-source" data={userGeoJson as any}>
          <Layer
            id="user-dot"
            type="circle"
            paint={{
              "circle-color": accentTheme.color,
              "circle-radius": 8,
              "circle-stroke-color": "#FFFFFF",
              "circle-stroke-width": 3,
            }}
          />
        </GeoJSONSource>
      </Map>

      {!mapReady && (
        <View style={styles.mapLoading} pointerEvents="none">
          <Text style={styles.mapLoadingText}>Загрузка карты...</Text>
        </View>
      )}

      <View style={[styles.topPanel, { top: Math.max(insets.top + 8, 48) }]}>
        <TouchableOpacity
          style={styles.topProfileButton}
          activeOpacity={0.82}
          onPress={() => setProfileModalVisible(true)}
        >
          <View
            style={[
              styles.topAvatar,
              { backgroundColor: accentTheme.color },
            ]}
          >
            <Text
              style={[
                styles.topAvatarText,
                { color: accentTheme.foreground },
              ]}
            >
              {userInitial}
            </Text>
          </View>
          <View style={styles.topTitleBlock}>
            <Text style={styles.logo}>WalkMap</Text>
            <Text style={styles.subtitle}>
              Открывай город прогулками
            </Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.topIconButtonSecondary}
          onPress={() => {
            refreshBackgroundRecordingStatus();
            setSettingsModalVisible(true);
          }}
        >
          <Text style={styles.gearButtonText}>⚙</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={[
          styles.mapLocateButton,
          {
            top: Math.max(insets.top + 8, 48) + 64,
            borderColor: accentTheme.border,
            shadowColor: accentTheme.color,
          },
        ]}
        activeOpacity={0.86}
        onPress={async () => {
          if (currentLocation) moveMapTo(currentLocation);
          try {
            const freshLocation = await Location.getCurrentPositionAsync({
              accuracy: Location.Accuracy.Balanced,
            });
            const freshPoint: WalkPoint = {
              latitude: freshLocation.coords.latitude,
              longitude: freshLocation.coords.longitude,
              timestamp: Date.now(),
            };
            setCurrentLocation(freshPoint);
            saveLastLocation(freshPoint);
            moveMapTo(freshPoint);
          } catch {}
        }}
      >
        <Text style={[styles.locateButtonText, { color: accentTheme.color }]}>⌖</Text>
      </TouchableOpacity>

      <View style={[styles.bottomPanel, { bottom: Math.max(insets.bottom + 12, 24) }]} pointerEvents="box-none">
        {isWalking && (
          <View style={styles.walkStatsFloatingRow}>
            <View style={[styles.walkStatCard, { borderColor: accentTheme.border }]}>
              <Text style={styles.statLabel}>Км</Text>
              <Text style={styles.statValue}>{formatKm(distanceKm)}</Text>
            </View>

            <View style={[styles.walkStatCard, { borderColor: accentTheme.border }]}>
              <Text style={styles.statLabel}>Время</Text>
              <Text style={styles.statValue}>{formatTime(durationSec)}</Text>
            </View>

            <View style={[styles.walkStatCard, { borderColor: accentTheme.border }]}>
              <Text style={styles.statLabel}>Радиус</Text>
              <Text style={styles.statValue}>{UNLOCK_RADIUS_METERS} м</Text>
            </View>
          </View>
        )}

        {!isWalking && (
          <View style={styles.homeCardsRow}>
            <TouchableOpacity
              style={[styles.homeInfoCard, { borderColor: accentTheme.border }]}
              onPress={() => setStatsModalVisible(true)}
            >
              <Text style={styles.homeInfoLabel}>Цель дня</Text>
              <Text style={[styles.homeInfoValue, { color: accentTheme.color }]}>
                {Math.max(
                  dailyProgress.cellsGoalPercent,
                  dailyProgress.distanceGoalPercent,
                )}
                %
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.homeInfoCard, { borderColor: "rgba(255,255,255,0.08)" }]}
              onPress={() => setStatsModalVisible(true)}
            >
              <Text style={styles.homeInfoLabel}>Серия</Text>
              <Text style={styles.homeInfoValue}>
                {progressStats.streak} дн.
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.homeInfoCard, { borderColor: "rgba(255,255,255,0.08)" }]}
              onPress={() => setAchievementsModalVisible(true)}
            >
              <Text style={styles.homeInfoLabel}>Награды</Text>
              <Text style={styles.homeInfoValue}>
                {unlockedAchievements.length}/{achievements.length}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {!isWalking ? (
          <TouchableOpacity
            style={[
              styles.primaryButton,
              { backgroundColor: accentTheme.color },
            ]}
            onPress={startWalk}
          >
            <Text style={[styles.buttonText, { color: accentTheme.foreground }]}>Начать прогулку</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.dangerButton} onPress={askFinishWalk}>
            <Text style={styles.buttonText}>Завершить прогулку</Text>
          </TouchableOpacity>
        )}
      </View>

      <Modal visible={appDialog !== null} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.appDialogCard,
              appDialog?.variant === "error" ? styles.appDialogCardError : null,
            ]}
          >
            <View
              style={[
                styles.appDialogIconCircle,
                appDialog?.variant === "success"
                  ? styles.appDialogIconSuccess
                  : null,
                appDialog?.variant === "warning"
                  ? styles.appDialogIconWarning
                  : null,
                appDialog?.variant === "error"
                  ? styles.appDialogIconError
                  : null,
                appDialog?.variant === "danger"
                  ? styles.appDialogIconDanger
                  : null,
              ]}
            >
              <Text style={[styles.appDialogIcon, { color: accentTheme.color }]}>
                {getDialogIcon(appDialog?.variant)}
              </Text>
            </View>

            <Text style={styles.appDialogTitle}>{appDialog?.title}</Text>
            <Text style={styles.appDialogText}>{appDialog?.message}</Text>

            {appDialog?.variant === "error" ? (
              <View style={styles.errorCopyBox}>
                <Text style={styles.errorCopyText} selectable>
                  {appDialog.copyText ||
                    `${appDialog.title}\n${appDialog.message}`}
                </Text>
              </View>
            ) : null}

            {appDialogCopied ? (
              <Text style={styles.appDialogCopied}>Скопировано</Text>
            ) : null}

            <View style={styles.appDialogActionsRow}>
              {getDialogActions(appDialog).map((action, index, actions) => (
                <TouchableOpacity
                  key={`${action.text}-${index}`}
                  style={[
                    styles.appDialogButton,
                    action.variant !== "secondary" && action.variant !== "danger"
                      ? { backgroundColor: accentTheme.color }
                      : null,
                    index < actions.length - 1 ? styles.appDialogButtonGap : null,
                    action.variant === "secondary"
                      ? styles.appDialogButtonSecondary
                      : null,
                    action.variant === "danger"
                      ? styles.appDialogButtonDanger
                      : null,
                    action.variant === "copy"
                      ? styles.appDialogButtonCopy
                      : null,
                  ]}
                  onPress={() => {
                    handleAppDialogAction(action);
                  }}
                >
                  <Text
                    style={[
                      styles.appDialogButtonText,
                      action.variant !== "secondary" && action.variant !== "danger"
                        ? { color: accentTheme.foreground }
                        : null,
                      action.variant === "secondary"
                        ? styles.appDialogButtonTextSecondary
                        : null,
                    ]}
                  >
                    {action.text}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={finishConfirmVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.finishCard}>
            <View style={styles.finishIconCircle}>
              <Text style={styles.finishIcon}>✓</Text>
            </View>

            <Text style={styles.finishTitle}>
              {finishConfirmMode === "short"
                ? "Сохранить короткую прогулку?"
                : "Завершить прогулку?"}
            </Text>
            <Text style={styles.finishText}>
              {finishConfirmMode === "short"
                ? "Похоже, ты только начал запись. Можно продолжить маршрут или сохранить как есть."
                : "Текущий маршрут будет сохранён в историю, а пройденная область останется открытой."}
            </Text>

            <View style={styles.finishStatsRow}>
              <View style={styles.finishStatBox}>
                <Text style={styles.finishStatLabel}>Км</Text>
                <Text style={styles.finishStatValue}>{formatKm(distanceKm)}</Text>
              </View>

              <View style={styles.finishStatBox}>
                <Text style={styles.finishStatLabel}>Время</Text>
                <Text style={styles.finishStatValue}>{formatTime(durationSec)}</Text>
              </View>

              <View style={styles.finishStatBox}>
                <Text style={styles.finishStatLabel}>Радиус</Text>
                <Text style={styles.finishStatValue}>{UNLOCK_RADIUS_METERS} м</Text>
              </View>
            </View>

            <TouchableOpacity
              style={styles.finishConfirmButton}
              onPress={confirmFinishWalk}
            >
              <Text style={styles.buttonText}>
                {finishConfirmMode === "short" ? "Сохранить" : "Завершить"}
              </Text>
            </TouchableOpacity>

            {finishConfirmMode === "short" && (
              <TouchableOpacity
                style={styles.finishDiscardButton}
                onPress={cancelWalk}
              >
                <Text style={styles.finishDiscardText}>Сбросить без сохранения</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={styles.finishCancelButton}
              onPress={() => setFinishConfirmVisible(false)}
            >
              <Text style={styles.secondaryButtonText}>Продолжить прогулку</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={profileModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.sheetCard}>
            <View style={styles.sheetDragHandle} />
            <View style={styles.sheetHeader}>
              <View>
                <Text style={styles.sheetTitle}>Профиль</Text>
                <Text style={styles.sheetSubtitle}>Твой прогресс WalkMap</Text>
              </View>

              <TouchableOpacity
                style={styles.closeButton}
                onPress={() => setProfileModalVisible(false)}
              >
                <Text style={styles.closeButtonText}>×</Text>
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={styles.profileHero}>
                <View
                  style={[
                    styles.profileAvatar,
                    { backgroundColor: accentTheme.color },
                  ]}
                >
                  <Text
                    style={[
                      styles.profileAvatarText,
                      { color: accentTheme.foreground },
                    ]}
                  >
                    {userInitial}
                  </Text>
                </View>

                <View style={styles.profileTextBlock}>
                  <Text style={styles.profileName}>{userNickname}</Text>
                  <Text style={styles.profileEmail} numberOfLines={1}>
                    {userProfileLabel}
                  </Text>
                  <Text style={[styles.profileLevel, { color: accentTheme.color }]}>
                    Ур. {levelInfo.level} · {levelInfo.title}
                  </Text>
                </View>
              </View>

              <View style={styles.nicknameCard}>
                <Text style={styles.menuActionTitle}>Ник</Text>
                <TextInput
                  style={styles.nicknameInput}
                  value={nicknameDraft}
                  onChangeText={handleNicknameDraftChange}
                  placeholder="Гость"
                  placeholderTextColor="#6F7A99"
                  maxLength={220}
                />
                <TouchableOpacity
                  style={[
                    styles.nicknameSaveButton,
                    { backgroundColor: accentTheme.color },
                    nicknameBusy && styles.disabledButton,
                  ]}
                  onPress={handleSaveNickname}
                  disabled={nicknameBusy}
                >
                  <Text
                    style={[
                      styles.nicknameSaveText,
                      { color: accentTheme.foreground },
                    ]}
                  >
                    Изменить ник
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={styles.menuLevelCard}>
                <View style={styles.levelTopRow}>
                  <Text style={styles.levelTitle}>Прогресс уровня</Text>
                  <Text style={[styles.levelSubtitle, { color: accentTheme.color }]}>
                    {levelInfo.progressPercent}%
                  </Text>
                </View>
                <View style={styles.progressTrack}>
                  <View
                    style={[
                      styles.progressFill,
                      {
                        width: `${levelInfo.progressPercent}%`,
                        backgroundColor: accentTheme.color,
                      },
                    ]}
                  />
                </View>
                <Text style={styles.progressText}>
                  {levelInfo.cellsToNextLevel > 0
                    ? `До следующего уровня: ${levelInfo.cellsToNextLevel} км`
                    : "Максимальный уровень"}
                </Text>
              </View>

              <View style={styles.bigStatsGrid}>
                <View style={styles.bigStatBox}>
                  <Text style={styles.bigStatValue}>{formatKm(progressStats.totalDistanceKm)}</Text>
                  <Text style={styles.bigStatLabel}>всего км</Text>
                </View>

                <View style={styles.bigStatBox}>
                  <Text style={styles.bigStatValue}>{history.length}</Text>
                  <Text style={styles.bigStatLabel}>прогулок</Text>
                </View>

                <View style={styles.bigStatBox}>
                  <Text style={styles.bigStatValue}>{progressStats.streak}</Text>
                  <Text style={styles.bigStatLabel}>серия</Text>
                </View>

                <View style={styles.bigStatBox}>
                  <Text style={styles.bigStatValue}>
                    {unlockedAchievements.length}/{achievements.length}
                  </Text>
                  <Text style={styles.bigStatLabel}>наград</Text>
                </View>
              </View>

              <View style={styles.profileSectionsGrid}>
                <TouchableOpacity
                  style={styles.profileSectionButton}
                  onPress={() => {
                    setProfileModalVisible(false);
                    setHistoryModalVisible(true);
                  }}
                >
                  <Text style={styles.menuActionTitle}>История</Text>
                  <Text style={styles.menuActionSubtitle}>{history.length} прогулок</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.profileSectionButton}
                  onPress={() => {
                    setProfileModalVisible(false);
                    setStatsModalVisible(true);
                  }}
                >
                  <Text style={styles.menuActionTitle}>Статистика</Text>
                  <Text style={styles.menuActionSubtitle}>
                    {formatKm(totalDistanceKm)} км · {formatArea(openedAreaKm2)}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.profileSectionButton}
                  onPress={() => {
                    setProfileModalVisible(false);
                    setAchievementsModalVisible(true);
                  }}
                >
                  <Text style={styles.menuActionTitle}>Достижения</Text>
                  <Text style={styles.menuActionSubtitle}>
                    {unlockedAchievements.length}/{achievements.length} открыто
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.profileSectionButton, { borderColor: accentTheme.border }]}
                  onPress={() => {
                    setProfileModalVisible(false);
                    refreshBackgroundRecordingStatus();
                    setSettingsModalVisible(true);
                  }}
                >
                  <Text style={styles.menuActionTitle}>Настройки</Text>
                  <Text style={styles.menuActionSubtitle}>Цвет, ник и запись</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={settingsModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.sheetCard}>
            <View style={styles.sheetDragHandle} />
            <View style={styles.sheetHeader}>
              <View>
                <Text style={styles.sheetTitle}>Настройки</Text>
                <Text style={styles.sheetSubtitle}>Профиль и запись прогулок</Text>
              </View>

              <TouchableOpacity
                style={styles.closeButton}
                onPress={() => setSettingsModalVisible(false)}
              >
                <Text style={styles.closeButtonText}>×</Text>
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={styles.accentCard}>
                <View style={styles.settingsStatusTop}>
                  <View>
                    <Text style={styles.menuActionTitle}>Цвет приложения</Text>
                    <Text style={styles.menuActionSubtitle}>
                      Акцент применяется сразу
                    </Text>
                  </View>
                  <Text style={[styles.accentCurrentName, { color: accentTheme.color }]}>
                    {accentTheme.title}
                  </Text>
                </View>

                <View style={styles.accentOptionsRow}>
                  {ACCENT_THEMES.map((theme) => {
                    const isSelected = theme.id === accentThemeId;

                    return (
                      <TouchableOpacity
                        key={theme.id}
                        accessibilityLabel={`Выбрать ${theme.title}`}
                        style={[
                          styles.accentOption,
                          {
                            borderColor: isSelected
                              ? theme.color
                              : "rgba(255,255,255,0.12)",
                            backgroundColor: isSelected
                              ? theme.soft
                              : "rgba(21, 28, 51, 0.92)",
                          },
                        ]}
                        onPress={() => handleAccentThemeSelect(theme.id)}
                      >
                        <View
                          style={[
                            styles.accentSwatch,
                            { backgroundColor: theme.color },
                          ]}
                        >
                          {isSelected ? (
                            <Text
                              style={[
                                styles.accentCheck,
                                { color: theme.foreground },
                              ]}
                            >
                              ✓
                            </Text>
                          ) : null}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <View style={styles.settingsStatusCard}>
                <View style={styles.settingsStatusTop}>
                  <View>
                    <Text style={styles.menuActionTitle}>Фоновая запись</Text>
                    <Text style={styles.menuActionSubtitle}>
                      Запись с заблокированным экраном
                    </Text>
                  </View>

                  <View style={styles.backgroundStatusMeta}>
                    <View
                      style={[
                        styles.backgroundStatusDot,
                        backgroundRecordingEnabled
                          ? { backgroundColor: accentTheme.color }
                          : styles.backgroundStatusDotOff,
                      ]}
                    />
                    <Text
                      style={[
                        styles.backgroundStatusText,
                        backgroundRecordingEnabled
                          ? { color: accentTheme.color }
                          : styles.backgroundStatusTextOff,
                      ]}
                    >
                      {backgroundRecordingEnabled ? "Включена" : "Выключена"}
                    </Text>
                  </View>
                </View>

                <Text style={styles.settingsHint}>
                  {backgroundRecordingEnabled
                    ? "Маршрут записывается даже с заблокированным экраном."
                    : "Для записи с заблокированным экраном нужны разрешения геолокации и настройки батареи."}
                </Text>

                {!backgroundRecordingEnabled && (
                  <View style={styles.backgroundActionsRow}>
                    <TouchableOpacity
                      style={[
                        styles.backgroundActionButton,
                        { backgroundColor: accentTheme.color },
                      ]}
                      onPress={() => {
                        setSettingsModalVisible(false);
                        showBatteryHelp();
                      }}
                    >
                      <Text
                        style={[
                          styles.backgroundActionText,
                          { color: accentTheme.foreground },
                        ]}
                      >
                        Настроить
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.backgroundActionButtonSecondary}
                      onPress={refreshBackgroundRecordingStatus}
                    >
                      <Text style={styles.backgroundActionTextSecondary}>
                        Проверить
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>

              <View style={styles.accountCard}>
                <Text style={styles.accountLabel}>Локальный профиль</Text>
                <Text style={styles.accountEmail} numberOfLines={1}>
                  {userNickname}
                </Text>
                <TextInput
                  style={styles.nicknameInput}
                  value={nicknameDraft}
                  onChangeText={handleNicknameDraftChange}
                  placeholder="Гость"
                  placeholderTextColor="#6F7A99"
                  maxLength={220}
                />
                <TouchableOpacity
                  style={[
                    styles.nicknameSaveButton,
                    { backgroundColor: accentTheme.color },
                    nicknameBusy && styles.disabledButton,
                  ]}
                  onPress={handleSaveNickname}
                  disabled={nicknameBusy}
                >
                  <Text
                    style={[
                      styles.nicknameSaveText,
                      { color: accentTheme.foreground },
                    ]}
                  >
                    Изменить ник
                  </Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={styles.menuActionButton}
                onPress={() => {
                  setSettingsModalVisible(false);
                  setProfileModalVisible(true);
                }}
              >
                <Text style={styles.menuActionTitle}>Открыть профиль</Text>
                <Text style={styles.menuActionSubtitle}>
                  Уровень, статистика, история и достижения
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.menuDangerButton}
                onPress={() => {
                  setSettingsModalVisible(false);
                  askResetData();
                }}
              >
                <Text style={styles.menuDangerText}>Сбросить прогресс</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.menuDangerButton}
                onPress={() => {
                  setSettingsModalVisible(false);
                  askResetApplication();
                }}
              >
                <Text style={styles.menuDangerText}>Сбросить всё приложение</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={resultModalVisible} transparent animationType="fade">
        <View
          style={[
            styles.modalOverlay,
            { paddingBottom: Math.max(insets.bottom + 16, 24) },
          ]}
        >
          <View
            style={[
              styles.resultCard,
              { maxHeight: height * 0.88 },
            ]}
          >
            <View style={styles.sheetDragHandle} />
            <Text style={styles.resultTitle}>Прогулка завершена</Text>

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 8 }}
              style={{ flexShrink: 1 }}
            >
              {lastResult && (
                <>
                  <View style={styles.resultBigRow}>
                    <Text style={[styles.resultBigValue, { color: accentTheme.color }]}>
                      {formatKm(lastResult.distanceKm)} км
                    </Text>
                    <Text style={styles.resultBigLabel}>пройдено</Text>
                  </View>

                  <View style={styles.resultGrid}>
                    <View style={styles.resultMiniBox}>
                      <Text style={styles.resultMiniLabel}>Время</Text>
                      <Text style={styles.resultMiniValue}>
                        {formatTime(lastResult.durationSec)}
                      </Text>
                    </View>

                    <View style={styles.resultMiniBox}>
                      <Text style={styles.resultMiniLabel}>Открытая область</Text>
                      <Text style={styles.resultMiniValue}>
                        {UNLOCK_RADIUS_METERS} м
                      </Text>
                    </View>

                    <View style={styles.resultMiniBox}>
                      <Text style={styles.resultMiniLabel}>Уровень</Text>
                      <Text style={styles.resultMiniValue}>
                        {levelInfo.level}
                      </Text>
                    </View>

                    <View style={styles.resultMiniBox}>
                      <Text style={styles.resultMiniLabel}>Серия</Text>
                      <Text style={styles.resultMiniValue}>
                        {progressStats.streak} дн.
                      </Text>
                    </View>
                  </View>

                  {lastUnlockedAchievements &&
                    lastUnlockedAchievements.length > 0 && (
                      <View style={styles.unlockedCard}>
                        <Text style={styles.unlockedTitle}>Новые достижения</Text>
                        {lastUnlockedAchievements.map((achievement) => (
                          <View key={achievement.id} style={styles.unlockedItem}>
                            <Text style={styles.unlockedIcon}>★</Text>
                            <View style={styles.unlockedTextBlock}>
                              <Text style={styles.unlockedName}>
                                {achievement.title}
                              </Text>
                              <Text style={styles.unlockedDescription}>
                                {achievement.description}
                              </Text>
                            </View>
                          </View>
                        ))}
                      </View>
                    )}
                </>
              )}
            </ScrollView>

            <TouchableOpacity
              style={[styles.primaryButton, { marginTop: 12, backgroundColor: accentTheme.color }]}
              hitSlop={{ top: 12, bottom: 12, left: 16, right: 16 }}
              onPress={() => setResultModalVisible(false)}
            >
              <Text style={[styles.buttonText, { color: accentTheme.foreground }]}>Отлично</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.secondaryButton, { marginTop: 8 }]}
              hitSlop={{ top: 12, bottom: 12, left: 16, right: 16 }}
              onPress={() => {
                setResultModalVisible(false);
                setHistoryModalVisible(true);
              }}
            >
              <Text style={styles.secondaryButtonText}>Посмотреть историю</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={historyModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.sheetCard}>
            <View style={styles.sheetDragHandle} />
            <View style={styles.sheetHeader}>
              <View>
                <Text style={styles.sheetTitle}>История прогулок</Text>
                <Text style={styles.sheetSubtitle}>
                  Всего прогулок: {history.length}
                </Text>
              </View>

              <TouchableOpacity
                style={styles.closeButton}
                onPress={() => setHistoryModalVisible(false)}
              >
                <Text style={styles.closeButtonText}>×</Text>
              </TouchableOpacity>
            </View>

            {history.length === 0 ? (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyTitle}>Пока пусто</Text>
                <Text style={styles.emptyText}>
                  Заверши первую прогулку, и она появится здесь.
                </Text>
              </View>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false}>
                {history.map((item, index) => {
                  const itemAchievements = item.achievementsUnlocked
                    ?.map(getAchievementById)
                    .filter(Boolean) as Achievement[] | undefined;

                  return (
                    <View key={item.id} style={styles.historyItem}>
                      <View style={styles.historyTopRow}>
                        <Text style={styles.historyTitle}>
                          Прогулка #{history.length - index}
                        </Text>
                        <Text style={styles.historyDate}>{item.date}</Text>
                      </View>

                      <View style={styles.historyStatsRow}>
                        <View style={styles.historyStat}>
                          <Text style={styles.historyStatLabel}>Км</Text>
                          <Text style={styles.historyStatValue}>
                            {formatKm(item.distanceKm)}
                          </Text>
                        </View>

                        <View style={styles.historyStat}>
                          <Text style={styles.historyStatLabel}>Время</Text>
                          <Text style={styles.historyStatValue}>
                            {formatTime(item.durationSec)}
                          </Text>
                        </View>

                        <View style={styles.historyStat}>
                          <Text style={styles.historyStatLabel}>Ср. скорость</Text>
                          <Text style={styles.historyStatValue}>
                            {formatSpeed(item.distanceKm, item.durationSec)} км/ч
                          </Text>
                        </View>
                      </View>

                      {itemAchievements && itemAchievements.length > 0 && (
                        <Text style={styles.historyAchievementText}>
                          ★ {itemAchievements.map((a) => a.title).join(", ")}
                        </Text>
                      )}
                    </View>
                  );
                })}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      <Modal visible={statsModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.sheetCard}>
            <View style={styles.sheetDragHandle} />
            <View style={styles.sheetHeader}>
              <View>
                <Text style={styles.sheetTitle}>Общая статистика</Text>
                <Text style={styles.sheetSubtitle}>Твой прогресс WalkMap</Text>
              </View>

              <TouchableOpacity
                style={styles.closeButton}
                onPress={() => setStatsModalVisible(false)}
              >
                <Text style={styles.closeButtonText}>×</Text>
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={styles.bigStatsGrid}>
                <View style={styles.bigStatBox}>
                  <Text style={styles.bigStatValue}>{history.length}</Text>
                  <Text style={styles.bigStatLabel}>прогулок</Text>
                </View>

                <View style={styles.bigStatBox}>
                  <Text style={styles.bigStatValue}>
                    {formatKm(totalDistanceKm)}
                  </Text>
                  <Text style={styles.bigStatLabel}>км всего</Text>
                </View>

                <View style={styles.bigStatBox}>
                  <Text style={styles.bigStatValue}>
                    {formatTime(totalDurationSec)}
                  </Text>
                  <Text style={styles.bigStatLabel}>в пути</Text>
                </View>

                <View style={styles.bigStatBox}>
                  <Text style={styles.bigStatValue}>
                    {history.length > 0 ? formatKm(progressStats.totalDistanceKm / history.length) : "0,00"}
                  </Text>
                  <Text style={styles.bigStatLabel}>в среднем км</Text>
                </View>

                <View style={styles.bigStatBox}>
                  <Text style={styles.bigStatValue}>
                    {formatKm(longestWalkKm)}
                  </Text>
                  <Text style={styles.bigStatLabel}>лучший маршрут</Text>
                </View>

                <View style={styles.bigStatBox}>
                  <Text style={styles.bigStatValue}>
                    {progressStats.streak}
                  </Text>
                  <Text style={styles.bigStatLabel}>дней серия</Text>
                </View>
              </View>

              <View style={styles.areaCard}>
                <Text style={styles.areaLabel}>Примерная открытая площадь</Text>
                <Text style={[styles.areaValue, { color: accentTheme.color }]}>{formatArea(openedAreaKm2)}</Text>
                <Text style={styles.areaHint}>
                  Расчёт приблизительный, потому что территория строится по GPS-радиусу.
                </Text>
              </View>

              <View style={styles.areaCard}>
                <Text style={styles.areaLabel}>Дневная цель</Text>
                <Text style={[styles.areaValue, { color: accentTheme.color }]}>
                  {Math.max(
                    dailyProgress.cellsGoalPercent,
                    dailyProgress.distanceGoalPercent,
                  )}
                  %
                </Text>
                <Text style={styles.areaHint}>
                  Сегодня: {dailyProgress.walks} прогулок · {formatKm(dailyProgress.distanceKm)} км
                </Text>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={achievementsModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.sheetCard}>
            <View style={styles.sheetDragHandle} />
            <View style={styles.sheetHeader}>
              <View>
                <Text style={styles.sheetTitle}>Достижения</Text>
                <Text style={styles.sheetSubtitle}>
                  Открыто: {unlockedAchievements.length}/{achievements.length}
                </Text>
              </View>

              <TouchableOpacity
                style={styles.closeButton}
                onPress={() => setAchievementsModalVisible(false)}
              >
                <Text style={styles.closeButtonText}>×</Text>
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {achievements.map((achievement) => (
                <View
                  key={achievement.id}
                  style={[
                    styles.achievementItem,
                    achievement.isUnlocked
                      ? [styles.achievementUnlocked, { backgroundColor: accentTheme.soft, borderColor: accentTheme.border }]
                      : styles.achievementLocked,
                  ]}
                >
                  <Text style={styles.achievementIcon}>
                    {achievement.isUnlocked ? "★" : "☆"}
                  </Text>
                  <View style={styles.achievementTextBlock}>
                    <Text style={styles.achievementTitle}>
                      {achievement.title}
                    </Text>
                    <Text style={styles.achievementDescription}>
                      {achievement.description}
                    </Text>
                  </View>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

    </View>
  );
}

const { height } = Dimensions.get("window");

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: M3_SURFACE.background,
  },
  authScreen: {
    flex: 1,
    backgroundColor: M3_SURFACE.background,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  authCard: {
    width: "100%",
    backgroundColor: M3_SURFACE.surfaceContainer,
    borderRadius: 28,
    padding: 26,
    borderWidth: 1,
    borderColor: M3_SURFACE.outlineVariant,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  authLogo: {
    color: M3_SURFACE.onSurface,
    fontSize: 36,
    fontWeight: "900",
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  authTitle: {
    color: M3_SURFACE.onSurface,
    fontSize: 26,
    fontWeight: "800",
    marginBottom: 8,
  },
  authSubtitle: {
    color: M3_SURFACE.onSurfaceVariant,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 20,
  },
  authNotice: {
    backgroundColor: "rgba(78, 222, 190, 0.12)",
    borderRadius: 16,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "rgba(78, 222, 190, 0.28)",
  },
  authNoticeText: {
    color: "#73FBDA",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
  },
  authInput: {
    backgroundColor: M3_SURFACE.surface,
    borderRadius: 16,
    color: M3_SURFACE.onSurface,
    fontSize: 16,
    fontWeight: "700",
    paddingHorizontal: 18,
    paddingVertical: 15,
    marginBottom: 12,
    borderWidth: 1.5,
    borderColor: M3_SURFACE.outline,
  },
  authPrimaryButton: {
    paddingVertical: 16,
    borderRadius: 28,
    alignItems: "center",
    marginTop: 8,
    elevation: 2,
  },
  authSwitchButton: {
    paddingVertical: 14,
    alignItems: "center",
  },
  authSwitchText: {
    color: M3_SURFACE.onSurfaceVariant,
    fontSize: 14,
    fontWeight: "800",
  },
  authGuestButton: {
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: M3_SURFACE.outline,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 6,
  },
  authGuestText: {
    fontSize: 14,
    fontWeight: "800",
    color: M3_SURFACE.onSurface,
  },
  authLoadingInline: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: M3_SURFACE.surfaceContainerLow,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 14,
  },
  authLoadingInlineText: {
    color: M3_SURFACE.onSurfaceVariant,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
    marginLeft: 10,
    flex: 1,
  },
  authLoadingText: {
    color: M3_SURFACE.onSurfaceVariant,
    fontSize: 15,
    fontWeight: "700",
    marginTop: 14,
  },
  disabledButton: {
    opacity: 0.5,
  },
  map: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  mapLoading: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: M3_SURFACE.background,
    alignItems: "center",
    justifyContent: "center",
  },
  mapLoadingText: {
    color: M3_SURFACE.onSurface,
    fontSize: 18,
    fontWeight: "700",
  },
  topPanel: {
    position: "absolute",
    top: 48, // overridden dynamically with insets
    left: 16,
    right: 16,
    backgroundColor: "rgba(26, 29, 39, 0.94)",
    borderRadius: 28,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: M3_SURFACE.outlineVariant,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  topTitleBlock: {
    flex: 1,
    paddingRight: 8,
  },
  topProfileButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    minHeight: 46,
  },
  topAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  topAvatarText: {
    fontSize: 19,
    fontWeight: "900",
  },
  logo: {
    color: M3_SURFACE.onSurface,
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: -0.3,
  },
  subtitle: {
    color: M3_SURFACE.onSurfaceVariant,
    fontSize: 12,
    marginTop: 2,
    fontWeight: "600",
  },
  topIconButtonSecondary: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(38, 44, 63, 0.96)",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 8,
    borderWidth: 1,
    borderColor: M3_SURFACE.outlineVariant,
  },
  mapLocateButton: {
    position: "absolute",
    right: 16,
    top: 136, // overridden dynamically with insets
    width: 54,
    height: 54,
    borderRadius: 18,
    backgroundColor: "rgba(26, 29, 39, 0.95)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    elevation: 6,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  locateButtonText: {
    fontSize: 24,
    fontWeight: "900",
  },
  floatingMenuButton: {
    position: "absolute",
    top: 162,
    right: 16,
    backgroundColor: "rgba(26, 29, 39, 0.95)",
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingVertical: 13,
  },
  bottomPanel: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 24, // overridden dynamically with insets
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  statusRowCompact: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  compactHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  menuPillButton: {
    backgroundColor: M3_SURFACE.surfaceContainerHigh,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: M3_SURFACE.outlineVariant,
  },
  menuPillText: {
    color: M3_SURFACE.onSurface,
    fontSize: 13,
    fontWeight: "800",
  },
  gearButtonText: {
    color: M3_SURFACE.onSurface,
    fontSize: 22,
    fontWeight: "800",
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  statusDotActive: {
    backgroundColor: "#4EDEBE", // kept as default; overridden by accentTheme.color inline
  },
  statusDotIdle: {
    backgroundColor: M3_SURFACE.onSurfaceVariant,
  },
  statusText: {
    color: M3_SURFACE.onSurface,
    fontSize: 13,
    fontWeight: "600",
  },
  levelCard: {
    backgroundColor: M3_SURFACE.surfaceContainer,
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: M3_SURFACE.outlineVariant,
  },
  levelTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  levelTitle: {
    color: M3_SURFACE.onSurface,
    fontSize: 18,
    fontWeight: "800",
  },
  levelSubtitle: {
    fontSize: 13,
    fontWeight: "800",
  },
  progressTrack: {
    height: 8,
    backgroundColor: M3_SURFACE.surfaceContainerHighest,
    borderRadius: 99,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 99,
  },
  dailyProgressFill: {
    height: "100%",
    borderRadius: 99,
  },
  progressText: {
    color: M3_SURFACE.onSurfaceVariant,
    fontSize: 12,
    fontWeight: "600",
    marginTop: 8,
  },
  statsRow: {
    flexDirection: "row",
    marginBottom: 12,
  },
  walkStatsFloatingRow: {
    flexDirection: "row",
    marginBottom: 10,
  },
  walkStatCard: {
    flex: 1,
    backgroundColor: "rgba(26, 29, 39, 0.94)",
    borderRadius: 20,
    padding: 14,
    marginRight: 8,
    borderWidth: 1,
  },
  homeCardsRow: {
    flexDirection: "row",
    marginBottom: 10,
  },
  homeInfoCard: {
    flex: 1,
    backgroundColor: "rgba(26, 29, 39, 0.94)",
    borderRadius: 20,
    padding: 14,
    marginRight: 8,
    minHeight: 74,
    justifyContent: "center",
    borderWidth: 1,
  },
  homeInfoLabel: {
    color: M3_SURFACE.onSurfaceVariant,
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 4,
  },
  homeInfoValue: {
    color: M3_SURFACE.onSurface,
    fontSize: 20,
    fontWeight: "900",
  },
  statBox: {
    flex: 1,
    backgroundColor: M3_SURFACE.surfaceContainer,
    borderRadius: 18,
    padding: 12,
    marginRight: 8,
    borderWidth: 1,
    borderColor: M3_SURFACE.outlineVariant,
  },
  statLabel: {
    color: M3_SURFACE.onSurfaceVariant,
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 4,
  },
  statValue: {
    color: M3_SURFACE.onSurface,
    fontSize: 18,
    fontWeight: "800",
  },
  dailyCard: {
    backgroundColor: M3_SURFACE.surfaceContainer,
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: M3_SURFACE.outlineVariant,
  },
  dailyTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  dailyTitle: {
    color: M3_SURFACE.onSurface,
    fontSize: 16,
    fontWeight: "800",
  },
  dailyBadge: {
    borderRadius: 99,
    paddingHorizontal: 12,
    paddingVertical: 4,
    fontSize: 12,
    fontWeight: "800",
    overflow: "hidden",
  },
  dailyText: {
    color: M3_SURFACE.onSurfaceVariant,
    fontSize: 13,
    fontWeight: "600",
    marginTop: 8,
    marginBottom: 10,
  },
  primaryButton: {
    paddingVertical: 18,
    borderRadius: 28,
    alignItems: "center",
    marginTop: 0,
    elevation: 4,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    // backgroundColor set inline via accentTheme.color
  },
  dangerButton: {
    backgroundColor: "#E04848",
    paddingVertical: 18,
    borderRadius: 28,
    alignItems: "center",
    marginTop: 0,
    elevation: 4,
  },
  buttonText: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "800",
  },
  secondaryButton: {
    paddingVertical: 15,
    borderRadius: 24,
    alignItems: "center",
    marginTop: 10,
    backgroundColor: M3_SURFACE.surfaceContainerHigh,
    borderWidth: 1,
    borderColor: M3_SURFACE.outlineVariant,
  },
  secondaryButtonText: {
    color: M3_SURFACE.onSurface,
    fontSize: 15,
    fontWeight: "700",
  },
  actionsRow: {
    flexDirection: "row",
    marginTop: 10,
  },
  smallButton: {
    flex: 1,
    backgroundColor: M3_SURFACE.surfaceContainer,
    borderRadius: 18,
    paddingVertical: 13,
    alignItems: "center",
    marginRight: 8,
    borderWidth: 1,
    borderColor: M3_SURFACE.outlineVariant,
  },
  smallButtonText: {
    color: M3_SURFACE.onSurface,
    fontSize: 12,
    fontWeight: "700",
  },
  legendRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 12,
    gap: 10,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
  },
  legendColor: {
    width: 12,
    height: 12,
    borderRadius: 4,
    marginRight: 6,
  },
  legendOld: {
    backgroundColor: "#6DB6FE",
  },
  legendCurrent: {
    backgroundColor: "#A8D1FF",
  },
  legendNew: {
    backgroundColor: "#4EDEBE",
  },
  legendText: {
    color: M3_SURFACE.onSurfaceVariant,
    fontSize: 12,
    fontWeight: "600",
  },
  compactInfoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 12,
    paddingHorizontal: 4,
  },
  compactInfoText: {
    color: M3_SURFACE.onSurfaceVariant,
    fontSize: 11,
    fontWeight: "700",
  },
  menuCard: {
    width: "100%",
    backgroundColor: M3_SURFACE.surfaceContainer,
    borderRadius: 28,
    padding: 22,
    borderWidth: 1,
    borderColor: M3_SURFACE.outlineVariant,
  },
  menuLevelCard: {
    backgroundColor: M3_SURFACE.surfaceContainerHigh,
    borderRadius: 22,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: M3_SURFACE.outlineVariant,
  },
  accountCard: {
    backgroundColor: M3_SURFACE.surfaceContainer,
    borderRadius: 22,
    padding: 18,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: M3_SURFACE.outlineVariant,
  },
  accountLabel: {
    color: M3_SURFACE.onSurfaceVariant,
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 4,
  },
  accountEmail: {
    color: M3_SURFACE.onSurface,
    fontSize: 16,
    fontWeight: "800",
  },
  menuActionButton: {
    backgroundColor: M3_SURFACE.surfaceContainer,
    borderRadius: 22,
    padding: 18,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: M3_SURFACE.outlineVariant,
  },
  menuActionTitle: {
    color: M3_SURFACE.onSurface,
    fontSize: 17,
    fontWeight: "800",
  },
  menuActionSubtitle: {
    color: M3_SURFACE.onSurfaceVariant,
    fontSize: 12,
    fontWeight: "600",
    marginTop: 4,
  },
  menuDangerButton: {
    backgroundColor: M3_SURFACE.errorContainer,
    borderRadius: 22,
    padding: 16,
    marginTop: 4,
    borderWidth: 1,
    borderColor: "rgba(235, 87, 87, 0.3)",
  },
  menuDangerText: {
    color: M3_SURFACE.error,
    fontSize: 16,
    fontWeight: "800",
    textAlign: "center",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.72)",
    alignItems: "center",
    justifyContent: "flex-end",
    paddingBottom: 16, // overridden dynamically with insets where needed
    paddingHorizontal: 12,
  },
  sheetDragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.25)",
    alignSelf: "center",
    marginBottom: 16,
  },
  appDialogCard: {
    width: "100%",
    backgroundColor: M3_SURFACE.surfaceContainer,
    borderRadius: 28,
    padding: 24,
    borderWidth: 1,
    borderColor: M3_SURFACE.outlineVariant,
    marginBottom: "auto",
    marginTop: "auto",
  },
  appDialogCardError: {
    borderColor: "rgba(235, 87, 87, 0.45)",
  },
  appDialogIconCircle: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: M3_SURFACE.surfaceContainerHigh,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  appDialogIconSuccess: {
    backgroundColor: "rgba(78, 222, 190, 0.18)",
  },
  appDialogIconWarning: {
    backgroundColor: "rgba(255, 185, 96, 0.18)",
  },
  appDialogIconError: {
    backgroundColor: M3_SURFACE.errorContainer,
  },
  appDialogIconDanger: {
    backgroundColor: M3_SURFACE.errorContainer,
  },
  appDialogIcon: {
    fontSize: 30,
    fontWeight: "900",
  },
  appDialogTitle: {
    color: M3_SURFACE.onSurface,
    fontSize: 24,
    fontWeight: "800",
    marginBottom: 8,
  },
  appDialogText: {
    color: M3_SURFACE.onSurfaceVariant,
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 21,
  },
  errorCopyBox: {
    backgroundColor: M3_SURFACE.surface,
    borderRadius: 16,
    padding: 14,
    marginTop: 14,
    borderWidth: 1,
    borderColor: M3_SURFACE.outlineVariant,
  },
  errorCopyText: {
    color: M3_SURFACE.onSurface,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "600",
  },
  appDialogCopied: {
    color: "#73FBDA",
    fontSize: 12,
    fontWeight: "800",
    marginTop: 10,
  },
  appDialogActionsRow: {
    flexDirection: "row",
    marginTop: 20,
  },
  appDialogButton: {
    flex: 1,
    paddingVertical: 15,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  appDialogButtonGap: {
    marginRight: 8,
  },
  appDialogButtonSecondary: {
    backgroundColor: M3_SURFACE.surfaceContainerHigh,
    borderWidth: 1,
    borderColor: M3_SURFACE.outlineVariant,
  },
  appDialogButtonDanger: {
    backgroundColor: "#E04848",
  },
  appDialogButtonCopy: {
    backgroundColor: "#4EDEBE", // copy button: themed inline via accentTheme.color
  },
  appDialogButtonText: {
    fontSize: 14,
    fontWeight: "800",
  },
  appDialogButtonTextSecondary: {
    color: M3_SURFACE.onSurface,
  },
  finishCard: {
    width: "100%",
    backgroundColor: M3_SURFACE.surfaceContainer,
    borderRadius: 28,
    padding: 24,
    marginBottom: "auto",
    marginTop: "auto",
    borderWidth: 1,
    borderColor: M3_SURFACE.outlineVariant,
  },
  finishIconCircle: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: "rgba(78, 222, 190, 0.18)", // will refine with accentTheme.soft inline if needed
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  finishIcon: {
    color: "#73FBDA",
    fontSize: 30,
    fontWeight: "900",
  },
  finishDiscardButton: {
    paddingVertical: 15,
    borderRadius: 24,
    alignItems: "center",
    marginTop: 10,
    backgroundColor: M3_SURFACE.errorContainer,
    borderWidth: 1,
    borderColor: "rgba(235, 87, 87, 0.3)",
  },
  finishDiscardText: {
    color: M3_SURFACE.error,
    fontSize: 15,
    fontWeight: "700",
  },
  finishTitle: {
    color: M3_SURFACE.onSurface,
    fontSize: 24,
    fontWeight: "800",
    marginBottom: 8,
  },
  finishText: {
    color: M3_SURFACE.onSurfaceVariant,
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 21,
    marginBottom: 16,
  },
  finishStatsRow: {
    flexDirection: "row",
    marginHorizontal: -4,
    marginBottom: 16,
  },
  finishStatBox: {
    flex: 1,
    backgroundColor: M3_SURFACE.surfaceContainerHigh,
    borderRadius: 18,
    padding: 12,
    marginHorizontal: 4,
    borderWidth: 1,
    borderColor: M3_SURFACE.outlineVariant,
  },
  finishStatLabel: {
    color: M3_SURFACE.onSurfaceVariant,
    fontSize: 11,
    fontWeight: "700",
    marginBottom: 4,
  },
  finishStatValue: {
    color: M3_SURFACE.onSurface,
    fontSize: 17,
    fontWeight: "900",
  },
  finishConfirmButton: {
    backgroundColor: "#E04848",
    paddingVertical: 17,
    borderRadius: 28,
    alignItems: "center",
  },
  finishCancelButton: {
    paddingVertical: 15,
    borderRadius: 24,
    alignItems: "center",
    marginTop: 10,
    backgroundColor: M3_SURFACE.surfaceContainerHigh,
    borderWidth: 1,
    borderColor: M3_SURFACE.outlineVariant,
  },
  profileHero: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: M3_SURFACE.surfaceContainer,
    borderRadius: 24,
    padding: 18,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: M3_SURFACE.outlineVariant,
  },
  profileAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 16,
  },
  profileAvatarText: {
    fontSize: 26,
    fontWeight: "900",
  },
  profileTextBlock: {
    flex: 1,
  },
  profileName: {
    color: M3_SURFACE.onSurface,
    fontSize: 22,
    fontWeight: "800",
  },
  profileEmail: {
    color: M3_SURFACE.onSurfaceVariant,
    fontSize: 13,
    fontWeight: "600",
    marginTop: 3,
  },
  profileLevel: {
    fontSize: 14,
    fontWeight: "800",
    marginTop: 6,
  },
  nicknameCard: {
    backgroundColor: M3_SURFACE.surfaceContainer,
    borderRadius: 22,
    padding: 18,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: M3_SURFACE.outlineVariant,
  },
  nicknameInput: {
    backgroundColor: M3_SURFACE.surface,
    borderRadius: 16,
    color: M3_SURFACE.onSurface,
    fontSize: 15,
    fontWeight: "700",
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginTop: 12,
    marginBottom: 12,
    borderWidth: 1.5,
    borderColor: M3_SURFACE.outline,
  },
  nicknameSaveButton: {
    borderRadius: 24,
    paddingVertical: 14,
    alignItems: "center",
  },
  nicknameSaveText: {
    fontSize: 14,
    fontWeight: "800",
  },
  settingsStatusCard: {
    backgroundColor: M3_SURFACE.surfaceContainer,
    borderRadius: 24,
    padding: 18,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: M3_SURFACE.outlineVariant,
  },
  accentCard: {
    backgroundColor: M3_SURFACE.surfaceContainer,
    borderRadius: 24,
    padding: 18,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: M3_SURFACE.outlineVariant,
  },
  accentCurrentName: {
    fontSize: 13,
    fontWeight: "800",
    marginLeft: 12,
  },
  accentOptionsRow: {
    flexDirection: "row",
    marginTop: 14,
  },
  accentOption: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
    borderWidth: 2,
  },
  accentSwatch: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  accentCheck: {
    fontSize: 18,
    fontWeight: "900",
  },
  settingsStatusTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backgroundStatusMeta: {
    flexDirection: "row",
    alignItems: "center",
    marginLeft: 12,
  },
  backgroundStatusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  backgroundStatusDotOff: {
    backgroundColor: M3_SURFACE.onSurfaceVariant,
  },
  backgroundStatusText: {
    fontSize: 13,
    fontWeight: "800",
  },
  backgroundStatusTextOff: {
    color: M3_SURFACE.onSurfaceVariant,
  },
  settingsHint: {
    color: M3_SURFACE.onSurfaceVariant,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 19,
    marginTop: 12,
  },
  backgroundActionsRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 14,
    gap: 10,
  },
  backgroundActionButton: {
    flex: 1,
    borderRadius: 24,
    paddingVertical: 14,
    alignItems: "center",
  },
  backgroundActionButtonSecondary: {
    flex: 1,
    borderRadius: 24,
    paddingVertical: 14,
    alignItems: "center",
    backgroundColor: M3_SURFACE.surfaceContainerHigh,
    borderWidth: 1,
    borderColor: M3_SURFACE.outlineVariant,
  },
  backgroundActionText: {
    fontSize: 13,
    fontWeight: "800",
  },
  backgroundActionTextSecondary: {
    color: M3_SURFACE.onSurface,
    fontSize: 13,
    fontWeight: "800",
  },
  resultCard: {
    width: "100%",
    maxHeight: height * 0.88,
    backgroundColor: M3_SURFACE.surfaceContainer,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    padding: 22,
    borderWidth: 1,
    borderColor: M3_SURFACE.outlineVariant,
  },
  resultTitle: {
    color: M3_SURFACE.onSurface,
    fontSize: 24,
    fontWeight: "800",
    marginBottom: 18,
    textAlign: "center",
  },
  resultBigRow: {
    backgroundColor: M3_SURFACE.surfaceContainerHigh,
    borderRadius: 24,
    padding: 20,
    marginBottom: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: M3_SURFACE.outlineVariant,
  },
  resultBigValue: {
    color: "#4EDEBE", // overridden inline by accentTheme.color
    fontSize: 38,
    fontWeight: "900",
  },
  resultBigLabel: {
    color: M3_SURFACE.onSurfaceVariant,
    fontSize: 14,
    fontWeight: "600",
    marginTop: 4,
  },
  resultGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginHorizontal: -4,
    marginBottom: 14,
  },
  resultMiniBox: {
    width: "50%",
    padding: 4,
  },
  resultMiniLabel: {
    color: M3_SURFACE.onSurfaceVariant,
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 4,
  },
  resultMiniValue: {
    color: M3_SURFACE.onSurface,
    fontSize: 18,
    fontWeight: "800",
    backgroundColor: M3_SURFACE.surfaceContainerHigh,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: M3_SURFACE.outlineVariant,
  },
  unlockedCard: {
    backgroundColor: M3_SURFACE.surfaceContainerHigh,
    borderRadius: 22,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: M3_SURFACE.outlineVariant,
  },
  unlockedTitle: {
    color: M3_SURFACE.onSurface,
    fontSize: 16,
    fontWeight: "800",
    marginBottom: 10,
  },
  unlockedItem: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  unlockedIcon: {
    color: "#FFB960",
    fontSize: 22,
    fontWeight: "900",
    marginRight: 12,
  },
  unlockedTextBlock: {
    flex: 1,
  },
  unlockedName: {
    color: M3_SURFACE.onSurface,
    fontSize: 14,
    fontWeight: "800",
  },
  unlockedDescription: {
    color: M3_SURFACE.onSurfaceVariant,
    fontSize: 12,
    fontWeight: "600",
    marginTop: 2,
  },
  sheetCard: {
    width: "100%",
    maxHeight: height * 0.85,
    backgroundColor: M3_SURFACE.surfaceContainer,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    padding: 22,
    borderWidth: 1,
    borderColor: M3_SURFACE.outlineVariant,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  sheetTitle: {
    color: M3_SURFACE.onSurface,
    fontSize: 24,
    fontWeight: "800",
  },
  sheetSubtitle: {
    color: M3_SURFACE.onSurfaceVariant,
    fontSize: 13,
    fontWeight: "600",
    marginTop: 3,
  },
  closeButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: M3_SURFACE.surfaceContainerHigh,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: M3_SURFACE.outlineVariant,
  },
  closeButtonText: {
    color: M3_SURFACE.onSurface,
    fontSize: 26,
    fontWeight: "600",
    lineHeight: 30,
  },
  emptyBox: {
    backgroundColor: M3_SURFACE.surfaceContainerHigh,
    borderRadius: 22,
    padding: 20,
    alignItems: "center",
    borderWidth: 1,
    borderColor: M3_SURFACE.outlineVariant,
  },
  emptyTitle: {
    color: M3_SURFACE.onSurface,
    fontSize: 18,
    fontWeight: "800",
    marginBottom: 6,
  },
  emptyText: {
    color: M3_SURFACE.onSurfaceVariant,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  historyItem: {
    backgroundColor: M3_SURFACE.surfaceContainerHigh,
    borderRadius: 22,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: M3_SURFACE.outlineVariant,
  },
  historyTopRow: {
    marginBottom: 12,
  },
  historyTitle: {
    color: M3_SURFACE.onSurface,
    fontSize: 17,
    fontWeight: "800",
  },
  historyDate: {
    color: M3_SURFACE.onSurfaceVariant,
    fontSize: 12,
    fontWeight: "600",
    marginTop: 3,
  },
  historyStatsRow: {
    flexDirection: "row",
  },
  historyStat: {
    flex: 1,
  },
  historyStatLabel: {
    color: M3_SURFACE.onSurfaceVariant,
    fontSize: 11,
    fontWeight: "600",
    marginBottom: 4,
  },
  historyStatValue: {
    color: M3_SURFACE.onSurface,
    fontSize: 15,
    fontWeight: "800",
  },
  historyAchievementText: {
    color: "#FFB960",
    fontSize: 12,
    fontWeight: "800",
    marginTop: 10,
  },
  bigStatsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginHorizontal: -5,
  },
  bigStatBox: {
    width: "50%",
    padding: 5,
  },
  bigStatValue: {
    color: M3_SURFACE.onSurface,
    fontSize: 24,
    fontWeight: "900",
    backgroundColor: M3_SURFACE.surfaceContainerHigh,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 14,
    paddingTop: 14,
    borderWidth: 1,
    borderColor: M3_SURFACE.outlineVariant,
    borderBottomWidth: 0,
  },
  bigStatLabel: {
    color: M3_SURFACE.onSurfaceVariant,
    fontSize: 13,
    fontWeight: "700",
    backgroundColor: M3_SURFACE.surfaceContainerHigh,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
    paddingHorizontal: 14,
    paddingBottom: 14,
    paddingTop: 4,
    borderWidth: 1,
    borderColor: M3_SURFACE.outlineVariant,
    borderTopWidth: 0,
  },
  profileSectionsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginHorizontal: -5,
    marginTop: 4,
  },
  profileSectionButton: {
    width: "50%",
    padding: 5,
    backgroundColor: M3_SURFACE.surfaceContainer,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: M3_SURFACE.outlineVariant,
    marginBottom: 10,
    paddingVertical: 16,
    paddingHorizontal: 14,
  },
  areaCard: {
    backgroundColor: M3_SURFACE.surfaceContainerHigh,
    borderRadius: 24,
    padding: 18,
    marginTop: 12,
    borderWidth: 1,
    borderColor: M3_SURFACE.outlineVariant,
  },
  areaLabel: {
    color: M3_SURFACE.onSurfaceVariant,
    fontSize: 13,
    fontWeight: "700",
  },
  areaValue: {
    color: "#4EDEBE", // overridden inline by accentTheme.color
    fontSize: 32,
    fontWeight: "900",
    marginTop: 4,
  },
  areaHint: {
    color: M3_SURFACE.onSurfaceVariant,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 8,
  },
  achievementItem: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 22,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: M3_SURFACE.outlineVariant,
  },
  achievementUnlocked: {
    backgroundColor: "rgba(78, 222, 190, 0.12)", // overridden inline by accentTheme.soft
    borderColor: "rgba(78, 222, 190, 0.3)", // overridden inline by accentTheme.border
  },
  achievementLocked: {
    backgroundColor: M3_SURFACE.surfaceContainerHigh,
    opacity: 0.7,
  },
  achievementIcon: {
    color: "#FFB960",
    fontSize: 28,
    fontWeight: "900",
    width: 40,
  },
  achievementTextBlock: {
    flex: 1,
  },
  achievementTitle: {
    color: M3_SURFACE.onSurface,
    fontSize: 16,
    fontWeight: "800",
  },
  achievementDescription: {
    color: M3_SURFACE.onSurfaceVariant,
    fontSize: 13,
    fontWeight: "600",
    marginTop: 4,
  },
});
