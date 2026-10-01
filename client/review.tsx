import type { ComponentType } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { useState } from "react";
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { output } from "zod";
import { reviewResultSchema } from "../shared/review";
import { parseDiffFiles } from "./diff";

type ReviewResultData = output<typeof reviewResultSchema>;

const verdictStyle = {
  pass: { bg: "#166534", text: "#f0fdf4", label: "通过" },
  review: { bg: "#92400e", text: "#fffbeb", label: "需复核" },
  reject: { bg: "#991b1b", text: "#fef2f2", label: "偏离目标" },
} as const;

const driftLabel = {
  in_scope: "在范围内",
  minor_drift: "轻微偏离",
  major_drift: "明显偏离",
} as const;

const resultLabel = {
  done: "已完成",
  partial: "部分完成",
  none: "未完成",
  unknown: "无法判断",
} as const;

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

export const ReviewResultItem: ComponentType<PluginTimelineItemProps<ReviewResultData>> = (
  props,
) => {
  const { data } = props.item;
  const v = verdictStyle[data.verdict];
  const drift = driftLabel[data.drift as keyof typeof driftLabel] ?? data.drift;
  const [expanded, setExpanded] = useState(false);
  const [openFile, setOpenFile] = useState<number | null>(null);
  const diffFiles = parseDiffFiles(data.diff);
  const totalAdded = diffFiles.reduce((total, file) => total + file.added, 0);
  const totalRemoved = diffFiles.reduce((total, file) => total + file.removed, 0);

  return (
    <View style={[styles.container, { backgroundColor: v.bg }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: v.text }]}>
          {v.label}
        </Text>
        <Text style={[styles.time, { color: v.text, opacity: 0.7 }]}>
          {formatTime(data.scoredAt)}
        </Text>
      </View>
      {data.goal ? (
        <Text numberOfLines={2} style={[styles.goal, { color: v.text, opacity: 0.95 }]}>
          目标：{data.goal}
        </Text>
      ) : null}
      <View style={styles.row}>
        {data.result ? (
          <Text style={[styles.stat, { color: v.text }]}>
            结果：{resultLabel[data.result]}
          </Text>
        ) : (
          <Text style={[styles.stat, { color: v.text }]}>
            完成度 {Math.round(data.completed * 100)}%
          </Text>
        )}
        <Text style={[styles.dot, { color: v.text }]}>·</Text>
        <Text style={[styles.stat, { color: v.text }]}>
          偏离 {drift}
        </Text>
      </View>
      {data.narrative ? (
        <Text selectable style={[styles.narrative, { color: v.text, opacity: 0.9 }]}>
          {data.narrative}
        </Text>
      ) : data.summary ? (
        <Text numberOfLines={2} style={[styles.summary, { color: v.text, opacity: 0.85 }]}>
          {data.summary}
        </Text>
      ) : null}
      {data.drifts?.length ? (
        <View style={styles.drifts}>
          {data.drifts.map((d, i) => (
            <Text key={i} numberOfLines={2} style={[styles.driftItem, { color: v.text, opacity: 0.8 }]}>
              偏离：{d}
            </Text>
          ))}
        </View>
      ) : null}
      {data.detail || diffFiles.length ? (
        <>
          <TouchableOpacity
            style={styles.expandBtn}
            activeOpacity={0.7}
            onPress={() => setExpanded((e) => !e)}
          >
            <Text style={[styles.expandLabel, { color: v.text, opacity: 0.7 }]}>
              {expanded ? "收起分析详情" : "展开分析详情"}
            </Text>
          </TouchableOpacity>
          {expanded ? (
            <View style={styles.detail}>
              {diffFiles.length ? (
                <View style={styles.diffBox}>
                  <View style={styles.diffSummary}>
                    <Text style={styles.diffHeading}>已编辑 {diffFiles.length} 个文件</Text>
                    <Text style={styles.added}>+{totalAdded}</Text>
                    <Text style={styles.removed}>-{totalRemoved}</Text>
                  </View>
                  {diffFiles.map((file, i) => (
                    <View key={`${file.path}-${i}`}>
                      <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel={`${file.path}，新增 ${file.added} 行，删除 ${file.removed} 行`}
                        onPress={() => setOpenFile(openFile === i ? null : i)}
                        style={styles.fileRow}
                      >
                        <Text style={styles.fileName} numberOfLines={1}>{file.path}</Text>
                        <Text style={styles.added}>+{file.added}</Text>
                        <Text style={styles.removed}>-{file.removed}</Text>
                        <Text style={styles.chevron}>{openFile === i ? "⌄" : "›"}</Text>
                      </TouchableOpacity>
                      {openFile === i ? (
                        <View style={styles.fileDiff}>
                          {file.lines.map((line, j) => (
                            <View key={j} style={[styles.diffLine, line.type === "add" ? styles.diffAdd : line.type === "remove" ? styles.diffRemove : line.type === "header" ? styles.diffHeader : null]}>
                              <Text selectable style={styles.diffText}>{line.content || " "}</Text>
                            </View>
                          ))}
                        </View>
                      ) : null}
                    </View>
                  ))}
                </View>
              ) : null}
              {data.detail ? (
                <>
                  <Text style={[styles.detailHeading, { color: v.text, opacity: 0.8 }]}>
                    发给大模型的审核提示词
                  </Text>
                  <Text selectable style={styles.detailText}>
                    {data.detail}
                  </Text>
                </>
              ) : null}
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderRadius: 8,
    padding: 12,
    marginVertical: 4,
    gap: 6,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  title: {
    fontSize: 14,
    fontWeight: "700",
  },
  time: {
    fontSize: 11,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  stat: {
    fontSize: 12,
  },
  dot: {
    fontSize: 12,
  },
  summary: {
    fontSize: 11,
  },
  narrative: {
    fontSize: 11,
    lineHeight: 16,
  },
  expandBtn: {
    paddingVertical: 4,
  },
  expandLabel: {
    fontSize: 11,
    textAlign: "center",
  },
  goal: {
    fontSize: 12,
    fontWeight: "600",
  },
  drifts: {
    gap: 2,
  },
  driftItem: {
    fontSize: 10,
    opacity: 0.8,
  },
  detail: {
    gap: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.15)",
    paddingTop: 6,
  },
  detailHeading: {
    fontSize: 10,
    fontWeight: "700",
  },
  diffBox: { backgroundColor: "#fff", borderRadius: 8, overflow: "hidden", marginBottom: 6 },
  diffSummary: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#e5e7eb" },
  diffHeading: { color: "#111827", fontSize: 12, fontWeight: "700", flex: 1 },
  fileRow: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 42, paddingHorizontal: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#e5e7eb" },
  fileName: { color: "#374151", fontSize: 12, flex: 1 },
  added: { color: "#15803d", fontSize: 12, fontWeight: "600" },
  removed: { color: "#b91c1c", fontSize: 12, fontWeight: "600" },
  chevron: { color: "#6b7280", fontSize: 16, width: 14, textAlign: "center" },
  fileDiff: { backgroundColor: "#f8fafc", paddingVertical: 4 },
  diffLine: { paddingHorizontal: 8, paddingVertical: 1 },
  diffAdd: { backgroundColor: "#dcfce7" },
  diffRemove: { backgroundColor: "#fee2e2" },
  diffHeader: { backgroundColor: "#e5e7eb" },
  diffText: { color: "#1f2937", fontFamily: "monospace", fontSize: 10 },
  detailText: {
    fontSize: 10,
    color: "#fff",
    opacity: 0.85,
    fontFamily: "monospace",
  },
});
