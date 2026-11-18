import { Connection, PublicKey } from '@solana/web3.js';
import { CONFIG } from '../config';
import type {
  Agent,
  GameReplay,
  MarketOutcome,
  Match,
  MatchCategory,
  MatchStatus,
  MoveStep,
  OnChainMarketStatus,
} from '../types';

const INITIAL_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const REQUEST_TIMEOUT_MS = 9000;
const FEE_BPS = 200; // 2% protocol fee on settled parimutuel pools

let sharedConnection: Connection | null = null;
function getConnection(): Connection {
  if (!sharedConnection) {
    sharedConnection = new Connection(CONFIG.rpcUrl, 'confirmed');
  }
  return sharedConnection;
}

function readU64LE(bytes: Uint8Array, offset: number): number {
  let value = 0n;
  for (let i = 0; i < 8; i += 1) {
    value |= BigInt(bytes[offset + i]) << BigInt(i * 8);
  }
  return Number(value);
}

function decodeOnChainMarket(data: Uint8Array): {
  marketStatus: OnChainMarketStatus;
  result: MarketOutcome | null;
  poolVolumeUsdc: number;
  whiteMultiplier: number;
  drawMultiplier: number;
  blackMultiplier: number;
} | null {
  if (data.length < 179) return null;
  const statusByte = data[144];
  const marketStatus: OnChainMarketStatus =
    statusByte === 0
      ? 'OPEN'
      : statusByte === 1
        ? 'LOCKED'
        : statusByte === 2
          ? 'SETTLED'
          : statusByte === 3
            ? 'CANCELLED'
            : statusByte === 4
              ? 'CLOSED'
              : 'UNKNOWN';
  const hasResult = data[145] === 1;
  const resultByte = hasResult ? data[146] : null;
  const result: MarketOutcome | null =
    resultByte === 0
      ? 'WHITE'
      : resultByte === 1
        ? 'DRAW'
        : resultByte === 2
          ? 'BLACK'
          : null;
  // Option<MarketOutcome> is 1 byte when None (0x00) and 2 bytes when Some (0x01, u8).
  const base = hasResult ? 147 : 146;
  const whitePool = readU64LE(data, base) / 1_000_000;
  const drawPool = readU64LE(data, base + 8) / 1_000_000;
  const blackPool = readU64LE(data, base + 16) / 1_000_000;
  const totalPool = readU64LE(data, base + 24) / 1_000_000;
  const netPool = totalPool * (1 - FEE_BPS / 10_000);
  const multiplierFor = (side: number) =>
    side > 0 && netPool > 0 ? Number((netPool / side).toFixed(2)) : 0;

  return {
    marketStatus,
    result,
    poolVolumeUsdc: Number(totalPool.toFixed(2)),
    whiteMultiplier: multiplierFor(whitePool),
    drawMultiplier: multiplierFor(drawPool),
    blackMultiplier: multiplierFor(blackPool),
  };
}

type DecodedMarket = NonNullable<ReturnType<typeof decodeOnChainMarket>>;
const marketAccountCache = new Map<string, { decoded: DecodedMarket; fetchedAt: number }>();
const MARKET_CACHE_TTL_MS = 4_000;

async function enrichMatchesOnChain(matches: Match[]): Promise<Match[]> {
  const withAddress = matches.filter(
    (m): m is Match & { marketAddress: string } => Boolean(m.marketAddress),
  );
  if (withAddress.length === 0) return matches;

  const now = Date.now();
  const stale = withAddress.filter((m) => {
    const cached = marketAccountCache.get(m.marketAddress);
    return !cached || now - cached.fetchedAt > MARKET_CACHE_TTL_MS;
  });

  if (stale.length > 0) {
    try {
      const pubkeys = stale.map((m) => new PublicKey(m.marketAddress));
      const infos = await Promise.race([
        getConnection().getMultipleAccountsInfo(pubkeys),
        new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 2_200)),
      ]);
      if (infos) {
        stale.forEach((m, idx) => {
          const info = infos[idx];
          if (info?.data) {
            const decoded = decodeOnChainMarket(info.data);
            if (decoded) {
              marketAccountCache.set(m.marketAddress, {
                decoded,
                fetchedAt: Date.now(),
              });
            }
          }
        });
      }
    } catch {
      // Fall back to any cached or API-provided values.
    }
  }

  return matches.map((match) => {
    if (!match.marketAddress) return match;
    const cached = marketAccountCache.get(match.marketAddress)?.decoded;
    if (!cached) return match;
    return {
      ...match,
      marketStatus: cached.marketStatus,
      result: match.result ?? cached.result,
      poolVolumeUsdc: cached.poolVolumeUsdc,
      marketEstimates: {
        ...match.marketEstimates,
        whiteMultiplier: cached.whiteMultiplier,
        drawMultiplier: cached.drawMultiplier,
        blackMultiplier: cached.blackMultiplier,
      },
    };
  });
}

export interface MatchesResult {
  matches: Match[];
  source: 'live';
  error: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function fallbackAgent(color: 'White' | 'Black', matchId: string): Agent {
  const isWhite = color === 'White';
  const name = isWhite ? 'Feras White Engine' : 'Feras Black Engine';
  return {
    id: `${matchId}-${color.toLowerCase()}`,
    name,
    handle: name.toLowerCase().replaceAll(' ', '-'),
    tagline: 'Autonomous Devnet chess agent',
    badgeEmoji: isWhite ? 'W' : 'B',
    tier: 'ENGINE',
    status: 'IN_MATCH',
    stats: {
      elo: 0,
      peakElo: 0,
      winRate: 0,
      favoredOpening: 'Stockfish',
    },
    architecture: {
      baseModel: 'Stockfish',
      parameters: 'Devnet',
      searchAlgorithm: 'UCI',
      evalDepth: 0,
    },
    earningsSol: 0,
    totalVolumeUsdc: 0,
  };
}

function normalizeAgent(value: unknown, fallback: Agent): Agent {
  const raw = isRecord(value) ? value : {};
  const stats = isRecord(raw.stats) ? raw.stats : {};
  const architecture = isRecord(raw.architecture) ? raw.architecture : {};
  return {
    ...fallback,
    id: stringValue(raw.id, fallback.id),
    name: stringValue(raw.name, fallback.name),
    handle: stringValue(raw.handle, fallback.handle),
    tagline: stringValue(raw.tagline, fallback.tagline),
    badgeEmoji: stringValue(raw.badgeEmoji, fallback.badgeEmoji),
    tier: stringValue(raw.tier, fallback.tier),
    status: stringValue(raw.status, fallback.status),
    stats: {
      elo: numberValue(stats.elo, fallback.stats.elo),
      peakElo: numberValue(stats.peakElo, fallback.stats.peakElo),
      winRate: numberValue(stats.winRate, fallback.stats.winRate),
      favoredOpening: stringValue(stats.favoredOpening, fallback.stats.favoredOpening),
    },
    architecture: {
      baseModel: stringValue(architecture.baseModel, fallback.architecture.baseModel),
      parameters: stringValue(architecture.parameters, fallback.architecture.parameters),
      searchAlgorithm: stringValue(
        architecture.searchAlgorithm,
        fallback.architecture.searchAlgorithm,
      ),
      evalDepth: numberValue(architecture.evalDepth, fallback.architecture.evalDepth),
    },
    earningsSol: numberValue(raw.earningsSol, fallback.earningsSol),
    totalVolumeUsdc: numberValue(raw.totalVolumeUsdc, fallback.totalVolumeUsdc),
    isUserOwned: raw.isUserOwned === true,
  };
}

function asSquare(value: unknown): string | null {
  return typeof value === 'string' && /^[a-h][1-8]$/.test(value) ? value : null;
}

function asPiece(value: unknown): string | null {
  return value === 'p' || value === 'n' || value === 'b' || value === 'r' || value === 'q' || value === 'k'
    ? value
    : null;
}

function normalizeReplay(value: unknown, id: string): GameReplay {
  const raw = isRecord(value) ? value : {};
  const moves: MoveStep[] = !Array.isArray(raw.moves)
    ? []
    : raw.moves.flatMap((move, index) => {
        if (!isRecord(move)) return [];
        const from = asSquare(move.from);
        const to = asSquare(move.to);
        const piece = asPiece(move.piece);
        const color = move.color === 'w' || move.color === 'b' ? move.color : null;
        if (!from || !to || !piece || !color) return [];
        return [
          {
            ply: numberValue(move.ply, index + 1),
            from,
            to,
            piece,
            color,
            san: stringValue(move.san, `${from}-${to}`),
            fen: stringValue(move.fen, INITIAL_FEN),
            evalCentipawns:
              typeof move.evalCentipawns === 'number' ? move.evalCentipawns : undefined,
            timeSpentSec: numberValue(move.timeSpentSec, 0),
            captured: asPiece(move.captured) ?? undefined,
            isCheck: move.isCheck === true,
            isCheckmate: move.isCheckmate === true,
            winProbabilityWhite: numberValue(move.winProbabilityWhite, 0.5),
          },
        ];
      });
  const result =
    raw.result === '1-0' || raw.result === '0-1' || raw.result === '1/2-1/2'
      ? raw.result
      : '*';
  return {
    matchId: stringValue(raw.matchId, id),
    initialFen: stringValue(raw.initialFen, INITIAL_FEN),
    moves,
    result,
    terminationReason: stringValue(raw.terminationReason, 'In progress'),
  };
}

function normalizeStatus(value: unknown): MatchStatus {
  if (value === 'UPCOMING' || value === 'SCHEDULED' || value === 'OPEN' || value === 'LOCKED') {
    return 'UPCOMING';
  }
  if (value === 'COMPLETED' || value === 'FINAL') return 'COMPLETED';
  return 'LIVE';
}

function normalizeCategory(value: unknown): MatchCategory {
  return value === 'CHAMPIONSHIP' ||
    value === 'GRAND_PRIX' ||
    value === 'HIGH_STAKES' ||
    value === 'BENCHMARK' ||
    value === 'DEVNET'
    ? value
    : 'BENCHMARK';
}

function normalizeMarketStatus(value: unknown): OnChainMarketStatus | undefined {
  return value === 'OPEN' ||
    value === 'LOCKED' ||
    value === 'SETTLED' ||
    value === 'CANCELLED' ||
    value === 'CLOSED' ||
    value === 'UNKNOWN'
    ? value
    : undefined;
}

export function normalizeMatch(value: unknown): Match {
  const raw = isRecord(value) ? value : {};
  const id = stringValue(raw.id, 'unknown-market');
  const whiteAgent = normalizeAgent(raw.whiteAgent, fallbackAgent('White', id));
  const blackAgent = normalizeAgent(raw.blackAgent, fallbackAgent('Black', id));
  const estimates = isRecord(raw.marketEstimates) ? raw.marketEstimates : {};
  const result =
    raw.result === 'WHITE' || raw.result === 'DRAW' || raw.result === 'BLACK'
      ? raw.result
      : null;
  const replay = normalizeReplay(raw.replay, id);
  const moveCount = numberValue(
    raw.moveCount,
    replay.moves.length || numberValue(raw.currentPly, 0),
  );

  return {
    id,
    title: stringValue(raw.title, 'Feras Devnet Market'),
    category: normalizeCategory(raw.category),
    status: normalizeStatus(raw.status),
    whiteAgent,
    blackAgent,
    currentPly: numberValue(raw.currentPly, 0),
    totalPlies: numberValue(raw.totalPlies, 0),
    moveCount,
    hasReplay: raw.hasReplay === true || replay.moves.length > 0,
    timeControl: stringValue(raw.timeControl, 'Devnet'),
    viewerCount: numberValue(raw.viewerCount, 0),
    poolVolumeUsdc: numberValue(raw.poolVolumeUsdc, 0),
    marketEstimates: {
      whiteMultiplier: numberValue(estimates.whiteMultiplier, 0),
      drawMultiplier: numberValue(estimates.drawMultiplier, 0),
      blackMultiplier: numberValue(estimates.blackMultiplier, 0),
      lastTickDirection:
        estimates.lastTickDirection === 'UP' ||
        estimates.lastTickDirection === 'DOWN' ||
        estimates.lastTickDirection === 'EQUAL'
          ? estimates.lastTickDirection
          : undefined,
    },
    currentFen: stringValue(raw.currentFen, INITIAL_FEN),
    replay,
    startedAt: stringValue(raw.startedAt, new Date().toISOString()),
    evalScore: numberValue(raw.evalScore, 0),
    result,
    marketAddress: typeof raw.marketAddress === 'string' ? raw.marketAddress : undefined,
    vaultAddress: typeof raw.vaultAddress === 'string' ? raw.vaultAddress : undefined,
    marketLockTime:
      typeof raw.marketLockTime === 'string' ? raw.marketLockTime : null,
    marketStatus: normalizeMarketStatus(raw.marketStatus),
  };
}

async function request(path: string): Promise<Match[]> {
  const response = await fetch(`${CONFIG.marketApiUrl}${path}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Market API responded with ${response.status}`);
  }
  const payload = (await response.json()) as unknown;
  if (!Array.isArray(payload)) {
    throw new Error('Market API returned an unexpected payload');
  }
  return payload.map(normalizeMatch);
}

export function sortMatches(matches: Match[]): Match[] {
  const weight: Record<MatchStatus, number> = { LIVE: 0, UPCOMING: 1, COMPLETED: 2 };
  return [...matches].sort((a, b) => {
    const byStatus = weight[a.status] - weight[b.status];
    if (byStatus !== 0) return byStatus;
    const aTime = new Date(a.marketLockTime ?? a.startedAt).getTime();
    const bTime = new Date(b.marketLockTime ?? b.startedAt).getTime();
    return bTime - aTime;
  });
}

const matchesListCache = new Map<string, MatchesResult>();
function cacheKeyForMatches(status?: MatchStatus, limit?: number): string {
  return `${status ?? 'ALL'}:${limit ?? 0}`;
}

export function getCachedMatches(
  status?: MatchStatus,
  limit?: number,
): MatchesResult | null {
  const exact = matchesListCache.get(cacheKeyForMatches(status, limit));
  if (exact) return exact;
  // If a larger unrestricted list was already loaded (e.g., on Arena), reuse a
  // slice of it immediately so Overview renders without a loading flash.
  if (!status && limit && limit > 0) {
    for (const [key, entry] of matchesListCache.entries()) {
      if (key.startsWith('ALL:') && entry.matches.length >= limit) {
        return {
          ...entry,
          matches: entry.matches.slice(0, limit),
        };
      }
    }
  }
  return null;
}

/**
 * The list endpoint intentionally ships no move payloads: one analyzed match
 * can be hundreds of kilobytes, and the arena only needs the selected one.
 */
export async function loadMatches(
  status?: MatchStatus,
  { limit }: { limit?: number } = {},
): Promise<MatchesResult> {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (limit && limit > 0) params.set('limit', String(Math.trunc(limit)));
  const query = params.size > 0 ? `?${params.toString()}` : '';
  try {
    const rawMatches = await request(`/v1/matches${query}`);
    const matches = await enrichMatchesOnChain(rawMatches);
    const result: MatchesResult = {
      matches: sortMatches(matches),
      source: 'live',
      error: null,
    };
    matchesListCache.set(cacheKeyForMatches(status, limit), result);
    return result;
  } catch (error) {
    return {
      matches: [],
      source: 'live',
      error:
        error instanceof Error
          ? error.message
          : 'The market API could not be reached.',
    };
  }
}

export async function loadMatch(id: string): Promise<Match | null> {
  const response = await fetch(`${CONFIG.marketApiUrl}/v1/matches/${encodeURIComponent(id)}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { Accept: 'application/json' },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Market API responded with ${response.status}`);
  const match = normalizeMatch(await response.json());
  const [enriched] = await enrichMatchesOnChain([match]);
  return enriched;
}

export async function loadMatchReplay(id: string): Promise<GameReplay> {
  const response = await fetch(
    `${CONFIG.marketApiUrl}/v1/matches/${encodeURIComponent(id)}/replay`,
    {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { Accept: 'application/json' },
    },
  );
  if (!response.ok) throw new Error(`Replay request failed (${response.status})`);
  return normalizeReplay(await response.json(), id);
}

function pieceFromSan(san: string): 'p' | 'n' | 'b' | 'r' | 'q' | 'k' {
  const trimmed = san.trim();
  if (trimmed.startsWith('O-O')) return 'k';
  const lead = trimmed[0];
  if (lead === 'N') return 'n';
  if (lead === 'B') return 'b';
  if (lead === 'R') return 'r';
  if (lead === 'Q') return 'q';
  if (lead === 'K') return 'k';
  return 'p';
}

export interface StreamMoveUpdate {
  step: MoveStep;
  sequence: number;
}

export interface StreamCompletedUpdate {
  result: MarketOutcome | null;
  rawResult: '1-0' | '0-1' | '1/2-1/2' | '*';
  reason: string;
  sequence: number;
}

/**
 * Subscribe to the backend's Server-Sent Events stream for a live/upcoming
 * match (`/v1/matches/:id/events/stream`). Returns a cleanup function.
 */
export function subscribeMatchEvents(
  matchId: string,
  {
    after = 0,
    onMove,
    onCompleted,
    onError,
  }: {
    after?: number;
    onMove?: (update: StreamMoveUpdate) => void;
    onCompleted?: (update: StreamCompletedUpdate) => void;
    onError?: () => void;
  },
): () => void {
  if (typeof EventSource === 'undefined') return () => {};
  const safeAfter = Math.max(0, Math.trunc(after));
  const url = `${CONFIG.marketApiUrl}/v1/matches/${encodeURIComponent(matchId)}/events/stream?after=${safeAfter}`;
  const source = new EventSource(url);

  source.addEventListener('MOVE', (rawEvent) => {
    try {
      const envelope = JSON.parse((rawEvent as MessageEvent).data) as unknown;
      if (!isRecord(envelope)) return;
      const sequence = numberValue(envelope.sequence, 0);
      const payload = isRecord(envelope.payload) ? envelope.payload : envelope;
      const ply = numberValue(payload.ply, 0);
      const uci = stringValue(payload.uci, '');
      const from = asSquare(uci.slice(0, 2));
      const to = asSquare(uci.slice(2, 4));
      if (!ply || !from || !to) return;

      const san = stringValue(payload.san, `${from}-${to}`);
      const fen = stringValue(payload.fen, INITIAL_FEN);
      const color: 'w' | 'b' = ply % 2 === 1 ? 'w' : 'b';
      const analysis = Array.isArray(payload.analysis) ? payload.analysis : [];
      const firstLine = isRecord(analysis[0]) ? analysis[0] : null;
      const evalCentipawns =
        firstLine && typeof firstLine.scoreCp === 'number'
          ? firstLine.scoreCp
          : undefined;
      const evalPawns = evalCentipawns != null ? evalCentipawns / 100 : 0;
      const winProbabilityWhite = 1 / (1 + Math.pow(10, -evalPawns / 4));

      onMove?.({
        sequence,
        step: {
          ply,
          from,
          to,
          piece: pieceFromSan(san),
          color,
          san,
          fen,
          evalCentipawns,
          timeSpentSec: numberValue(payload.timeSpentMs, 0) / 1000,
          isCheck: san.includes('+') || san.includes('#'),
          isCheckmate: san.includes('#'),
          winProbabilityWhite,
        },
      });
    } catch {
      // Ignore malformed SSE frames.
    }
  });

  source.addEventListener('GAME_COMPLETED', (rawEvent) => {
    try {
      const envelope = JSON.parse((rawEvent as MessageEvent).data) as unknown;
      if (!isRecord(envelope)) return;
      const sequence = numberValue(envelope.sequence, 0);
      const payload = isRecord(envelope.payload) ? envelope.payload : envelope;
      const rawResult =
        payload.result === '1-0' ||
        payload.result === '0-1' ||
        payload.result === '1/2-1/2'
          ? payload.result
          : '*';
      const result: MarketOutcome | null =
        rawResult === '1-0'
          ? 'WHITE'
          : rawResult === '0-1'
            ? 'BLACK'
            : rawResult === '1/2-1/2'
              ? 'DRAW'
              : null;
      onCompleted?.({
        sequence,
        rawResult,
        result,
        reason: stringValue(payload.reason, 'Completed'),
      });
    } catch {
      // Ignore malformed SSE frames.
    }
  });

  source.onerror = () => {
    onError?.();
  };

  return () => {
    source.close();
  };
}
