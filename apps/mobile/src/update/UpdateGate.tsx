/**
 * In-app update gate. Mounted once at the app root; overlays the app but never
 * owns navigation. One AppState listener for the process lifetime; network is
 * throttled to once per 6h and failures stay silent. The prompt shows at most
 * once per process session.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '../components/Icon';
import { radius, spacing, typeScale } from '../theme';
import type { Palette } from '../theme';
import {
  CHECK_THROTTLE_MS,
  fetchLatestRelease,
  getInstalledVersion,
  loadLastCheckedAt,
  loadSnapshot,
  saveDismissed,
} from './service';
import { decide, isAllowedReleaseUrl, type Dismissed, type ReleaseInfo } from './policy';
import { compareVersions } from './version';

export function UpdateGate({ palette, enabled }: { palette: Palette; enabled: boolean }) {
  const [release, setRelease] = useState<ReleaseInfo | null>(null);
  const [dismissed, setDismissed] = useState<Dismissed | null>(null);
  const [visible, setVisible] = useState(false);
  const [linkError, setLinkError] = useState(false);

  const installed = useRef<string | null>(null);
  const promptShown = useRef(false);
  const checking = useRef(false);

  const check = useCallback(async () => {
    const installedVersion = installed.current;
    if (!installedVersion || checking.current) return;
    if (Date.now() - (await loadLastCheckedAt()) < CHECK_THROTTLE_MS) return;
    checking.current = true;
    try {
      const latest = await fetchLatestRelease(installedVersion);
      if (latest) setRelease(latest);
    } finally {
      checking.current = false;
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    installed.current = getInstalledVersion();
    if (!installed.current) return; // fail closed: no reliable version → no prompt

    let alive = true;
    (async () => {
      const snapshot = await loadSnapshot();
      if (!alive) return;
      setDismissed(snapshot.dismissed);
      if (snapshot.release) setRelease(snapshot.release);
      await check();
    })();

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    return () => {
      alive = false;
      sub.remove();
    };
  }, [enabled, check]);

  // Decide visibility. Clear a dismissal only when it can no longer apply:
  // the installed build caught up, or a newer release supersedes it.
  useEffect(() => {
    const installedVersion = installed.current;
    if (!enabled || !installedVersion || !release) return;
    if (dismissed && (compareVersions(release.version, installedVersion) !== 1 || dismissed.version !== release.version)) {
      saveDismissed(null);
      setDismissed(null);
      return;
    }
    const decision = decide({
      installed: installedVersion,
      release,
      dismissed,
      promptShownThisSession: promptShown.current,
      now: Date.now(),
    });
    if (decision === 'prompt') {
      promptShown.current = true;
      setVisible(true);
    }
  }, [enabled, release, dismissed]);

  const dismiss = useCallback(
    async (mode: 'snooze' | 'skip') => {
      setVisible(false);
      setLinkError(false);
      if (!release) return;
      const next: Dismissed = { version: release.version, mode, at: Date.now() };
      setDismissed(next);
      await saveDismissed(next);
    },
    [release],
  );

  const openRelease = useCallback(async () => {
    if (!release || !isAllowedReleaseUrl(release.pageUrl)) {
      setLinkError(true);
      return;
    }
    try {
      await Linking.openURL(release.pageUrl);
    } catch {
      setLinkError(true); // keep the prompt open with inline recovery copy
    }
  }, [release]);

  const insets = useSafeAreaInsets();

  if (!visible || !release) return null;

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => dismiss('snooze')}
    >
      <View style={[styles.scrim, { backgroundColor: palette.scrim, paddingTop: insets.top }]}>
        <View
          accessibilityViewIsModal
          style={[styles.dialog, { backgroundColor: palette.surface }]}
        >
          <View style={styles.headerRow}>
            <Icon name="system-update" size={24} color={palette.accentText} />
            <Text style={[styles.title, { color: palette.text }]}>Pembaruan tersedia</Text>
          </View>
          <Text style={[styles.body, { color: palette.textSecondary }]}>
            Versi {release.version} sudah tersedia. Kamu memakai versi {installed.current}.
          </Text>
          {linkError ? (
            <Text style={[styles.errorText, { color: palette.error }]}>
              Tidak bisa membuka halaman rilis. Coba lagi atau buka GitHub secara manual.
            </Text>
          ) : null}
          <View style={styles.actions}>
            <Pressable
              onPress={() => dismiss('snooze')}
              accessibilityRole="button"
              accessibilityLabel="Nanti"
              style={({ pressed }) => [styles.target, pressed && styles.pressed]}
            >
              <Text style={[styles.textBtn, { color: palette.accentText }]}>Nanti</Text>
            </Pressable>
            <Pressable
              onPress={() => dismiss('skip')}
              accessibilityRole="button"
              accessibilityLabel="Lewati versi ini"
              style={({ pressed }) => [styles.target, pressed && styles.pressed]}
            >
              <Text style={[styles.textBtn, { color: palette.textSecondary }]}>
                Lewati versi ini
              </Text>
            </Pressable>
            <Pressable
              onPress={openRelease}
              accessibilityRole="button"
              accessibilityLabel="Update sekarang"
              style={({ pressed }) => [
                styles.target,
                styles.primary,
                pressed && styles.pressed,
                { backgroundColor: palette.accent },
              ]}
            >
              <Text style={[styles.primaryText, { color: palette.onAccent }]}>
                Update sekarang
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  dialog: {
    width: '100%',
    maxWidth: 420,
    borderRadius: radius.lg,
    padding: spacing.xl,
    gap: spacing.md,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { fontSize: typeScale.titleLarge, fontWeight: '700' },
  body: { fontSize: typeScale.body, lineHeight: 21 },
  errorText: { fontSize: typeScale.label, lineHeight: 18 },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  target: {
    minHeight: 48,
    minWidth: 48,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
  },
  primary: { paddingHorizontal: spacing.xl },
  primaryText: { fontSize: typeScale.body, fontWeight: '700' },
  textBtn: { fontSize: typeScale.body, fontWeight: '600' },
  pressed: { opacity: 0.7 },
});
