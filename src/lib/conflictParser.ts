export interface NormalSegment {
  kind: 'normal';
  lines: string[];
}

export interface ConflictSegment {
  kind: 'conflict';
  oursLabel: string;
  theirsLabel: string;
  oursLines: string[];
  theirsLines: string[];
}

export type FileSegment = NormalSegment | ConflictSegment;

const OURS_MARKER = /^<{7}\s?(.*)/;
const SEPARATOR = /^={7}$/;
const THEIRS_MARKER = /^>{7}\s?(.*)/;

export function parseConflicts(content: string): FileSegment[] | null {
  const lines = content.split('\n');
  const segments: FileSegment[] = [];
  let normalLines: string[] = [];
  let foundConflict = false;

  let i = 0;
  while (i < lines.length) {
    const oursMatch = lines[i].match(OURS_MARKER);
    if (oursMatch) {
      // Flush any accumulated normal lines
      if (normalLines.length > 0) {
        segments.push({ kind: 'normal', lines: normalLines });
        normalLines = [];
      }

      const oursLabel = oursMatch[1] || 'Current Change';
      const oursLines: string[] = [];
      i++;

      // Collect ours lines until separator
      while (i < lines.length && !SEPARATOR.test(lines[i])) {
        oursLines.push(lines[i]);
        i++;
      }

      if (i >= lines.length) {
        // Malformed: no separator found, treat as normal text
        normalLines.push(lines[i - oursLines.length - 1]);
        normalLines.push(...oursLines);
        continue;
      }

      // Skip separator
      i++;

      const theirsLines: string[] = [];
      // Collect theirs lines until theirs marker
      while (i < lines.length && !THEIRS_MARKER.test(lines[i])) {
        theirsLines.push(lines[i]);
        i++;
      }

      if (i >= lines.length) {
        // Malformed: no theirs marker found, treat as normal text
        normalLines.push(`<<<<<<< ${oursLabel}`);
        normalLines.push(...oursLines);
        normalLines.push('=======');
        normalLines.push(...theirsLines);
        continue;
      }

      const theirsMatch = lines[i].match(THEIRS_MARKER);
      const theirsLabel = theirsMatch?.[1] || 'Incoming Change';
      i++;

      segments.push({
        kind: 'conflict',
        oursLabel,
        theirsLabel,
        oursLines,
        theirsLines,
      });
      foundConflict = true;
    } else {
      normalLines.push(lines[i]);
      i++;
    }
  }

  // Flush remaining normal lines
  if (normalLines.length > 0) {
    segments.push({ kind: 'normal', lines: normalLines });
  }

  return foundConflict ? segments : null;
}

export function resolveConflict(
  segments: FileSegment[],
  conflictIndex: number,
  resolution: 'ours' | 'theirs' | 'both'
): string {
  let conflictCount = 0;
  const outputLines: string[] = [];

  for (const segment of segments) {
    if (segment.kind === 'normal') {
      outputLines.push(...segment.lines);
    } else {
      if (conflictCount === conflictIndex) {
        // Resolve this conflict
        if (resolution === 'ours') {
          outputLines.push(...segment.oursLines);
        } else if (resolution === 'theirs') {
          outputLines.push(...segment.theirsLines);
        } else {
          outputLines.push(...segment.oursLines);
          outputLines.push(...segment.theirsLines);
        }
      } else {
        // Preserve this conflict with markers
        outputLines.push(`<<<<<<< ${segment.oursLabel}`);
        outputLines.push(...segment.oursLines);
        outputLines.push('=======');
        outputLines.push(...segment.theirsLines);
        outputLines.push(`>>>>>>> ${segment.theirsLabel}`);
      }
      conflictCount++;
    }
  }

  return outputLines.join('\n');
}

export function hasConflictMarkers(content: string): boolean {
  return /^<{7}\s/m.test(content);
}
