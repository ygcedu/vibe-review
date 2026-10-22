import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useRpc, type PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { Modal } from "@getpaseo/plugin/client/react-native";
import { gitCompareLocalRpc, type ChangedFile, type GitCommit } from "../shared/git-history";
import { FileTypeIcon } from "./diff/file-icons";

export function HistoryCompare({ workspaceId, theme, commit, onClose, onFile }: Pick<PluginWorkspacePanelProps, "workspaceId" | "theme"> & { commit: GitCommit; onClose(): void; onFile(file: ChangedFile): void }) {
  const compare = useRpc(gitCompareLocalRpc);
  const [files, setFiles] = useState<ChangedFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const colors = theme.colors;
  useEffect(() => {
    let active = true;
    setLoading(true); setError("");
    void compare({ workspaceId, hash: commit.hash }).then((value) => { if (active) setFiles(value.files); }, (reason) => { if (active) setError(String(reason)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [workspaceId, commit.hash, revision]);
  return <Modal title="与本地比较" open onOpenChange={(open) => { if (!open) onClose(); }}><Modal.Content contentContainerStyle={styles.content}>
    <Text style={[styles.caption, { color: colors.foregroundMuted }]}>{commit.hash.slice(0, 8)} → 当前工作区 · 包括已暂存和未暂存的受跟踪文件</Text>
    {loading ? <ActivityIndicator color={colors.accent} /> : error ? <Text accessibilityRole="alert" style={[styles.caption, { color: colors.statusDanger }]}>{error}</Text> : files.length ? files.map((file) => <Pressable key={file.path} accessibilityRole="button" accessibilityLabel={`比较 ${file.path}`} onPress={() => onFile(file)} style={({ pressed }) => [styles.file, { backgroundColor: pressed ? colors.surface2 : colors.surface1 }]}>
      <View style={styles.icon}><FileTypeIcon fileName={file.path} /></View>
      <Text style={[styles.path, { color: colors.foreground }]}>{file.path}</Text>
      <Text style={[styles.caption, { color: file.status === "D" ? colors.statusDanger : file.status === "A" ? colors.statusSuccess : colors.foregroundMuted }]}>{file.status}</Text>
    </Pressable>) : <Text style={[styles.caption, { color: colors.foregroundMuted }]}>本地受跟踪文件与此版本一致</Text>}
    <Pressable accessibilityRole="button" onPress={() => setRevision((value) => value + 1)}><Text style={[styles.caption, { color: colors.accent }]}>刷新比较</Text></Pressable>
  </Modal.Content></Modal>;
}
const styles = StyleSheet.create({ content: { padding: 20, gap: 8 }, caption: { fontSize: 12, lineHeight: 18 }, file: { flexDirection: "row", alignItems: "center", padding: 10, borderRadius: 6, gap: 8 }, icon: { width: 16, height: 16, flexShrink: 0 }, path: { flex: 1, minWidth: 0, fontSize: 12, lineHeight: 18 } });
