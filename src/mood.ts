import type { MaxInt, Track } from '@spotify/web-api-ts-sdk';
import { z } from 'zod';
import type { SpotifyHandlerExtra, tool } from './types.js';
import {
  formatDuration,
  getAccessTokenString,
  getDefaultDeviceId,
  handleSpotifyRequest,
} from './utils.js';

const MOODS = [
  'happy',
  'sad',
  'energetic',
  'chill',
  'focused',
  'romantic',
  'nostalgic',
  'party',
  'workout',
  'sleepy',
] as const;

type Mood = (typeof MOODS)[number];

// Spotify deprecated /v1/recommendations in November 2024 (it returns 404 for
// this app), so moods are built from search queries instead of seed tracks.
const moodConfig: Record<
  Mood,
  { queries: string[]; description: string; emoji: string }
> = {
  happy: {
    queries: ['happy feel good hits', 'good vibes', 'genre:pop happy'],
    description: 'Upbeat and cheerful tracks to brighten your day! 🌟',
    emoji: '😊',
  },
  sad: {
    queries: ['sad songs', 'heartbreak acoustic', 'melancholy indie'],
    description:
      'Melancholic and introspective songs for when you need to feel understood 💙',
    emoji: '😢',
  },
  energetic: {
    queries: ['energy boost', 'adrenaline rock', 'genre:electronic energy'],
    description: 'High-energy tracks to get your blood pumping! ⚡',
    emoji: '⚡',
  },
  chill: {
    queries: ['chill vibes', 'lofi chill', 'mellow acoustic'],
    description: 'Relaxed and mellow vibes for unwinding 🧘‍♀️',
    emoji: '🧘‍♀️',
  },
  focused: {
    queries: ['deep focus', 'instrumental study', 'concentration piano'],
    description: 'Concentration-friendly tracks to boost productivity 🎯',
    emoji: '🎯',
  },
  romantic: {
    queries: ['love songs', 'romantic soul', 'date night r&b'],
    description: 'Intimate and romantic songs for special moments 💕',
    emoji: '💕',
  },
  nostalgic: {
    queries: ['throwback hits', '80s classics', '90s hits'],
    description: 'Songs that take you back to cherished memories 📸',
    emoji: '📸',
  },
  party: {
    queries: ['party hits', 'dance party', 'genre:dance party anthems'],
    description: 'High-energy party anthems to get the celebration started! 🎉',
    emoji: '🎉',
  },
  workout: {
    queries: ['workout motivation', 'gym hits', 'running music'],
    description: 'Motivational tracks to power through your workout! 💪',
    emoji: '💪',
  },
  sleepy: {
    queries: ['sleep calm piano', 'bedtime acoustic', 'ambient sleep'],
    description: 'Gentle and soothing songs to help you drift off to sleep 🌙',
    emoji: '🌙',
  },
};

// Fisher-Yates shuffle
function shuffleTracks<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

async function findMoodTracks(mood: Mood, limit: number): Promise<Track[]> {
  const { queries } = moodConfig[mood];

  const results = await handleSpotifyRequest(async (spotifyApi) => {
    return await Promise.all(
      queries.map((query) =>
        spotifyApi.search(query, ['track'], undefined, 50 as MaxInt<50>),
      ),
    );
  });

  const seen = new Set<string>();
  const pool: Track[] = [];
  for (const result of results) {
    for (const track of result.tracks?.items ?? []) {
      if (track?.id && !seen.has(track.id)) {
        seen.add(track.id);
        pool.push(track);
      }
    }
  }

  return shuffleTracks(pool).slice(0, limit);
}

// Mood-based playlist generator with time awareness
const createMoodPlaylist: tool<{
  mood: z.ZodEnum<
    [
      'happy',
      'sad',
      'energetic',
      'chill',
      'focused',
      'romantic',
      'nostalgic',
      'party',
      'workout',
      'sleepy',
    ]
  >;
  duration: z.ZodOptional<z.ZodEnum<['short', 'medium', 'long']>>;
  includeTimeBased: z.ZodOptional<z.ZodBoolean>;
}> = {
  name: 'createMoodPlaylist',
  description:
    'Create a personalized playlist based on your mood and current time of day',
  schema: {
    mood: z.enum(MOODS).describe('The mood you want the playlist to reflect'),
    duration: z
      .enum(['short', 'medium', 'long'])
      .optional()
      .describe(
        'Playlist duration: short (10-15 tracks), medium (20-30 tracks), long (40-50 tracks)',
      ),
    includeTimeBased: z
      .boolean()
      .optional()
      .describe('Whether to consider current time of day in recommendations'),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { mood, duration = 'medium', includeTimeBased = true } = args;

    // Get current time for time-based naming
    const now = new Date();
    const hour = now.getHours();
    const timeOfDay =
      hour < 6
        ? 'night'
        : hour < 12
          ? 'morning'
          : hour < 18
            ? 'afternoon'
            : 'evening';

    const config = moodConfig[mood];
    const trackCount =
      duration === 'short' ? 15 : duration === 'medium' ? 25 : 45;

    try {
      const tracks = await findMoodTracks(mood, trackCount);

      if (tracks.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: `Sorry, I couldn't find any ${mood} tracks for you right now. Try a different mood!`,
            },
          ],
        };
      }

      // Create playlist name with time awareness
      const timePrefix = includeTimeBased
        ? timeOfDay === 'morning'
          ? 'Morning '
          : timeOfDay === 'afternoon'
            ? 'Afternoon '
            : timeOfDay === 'evening'
              ? 'Evening '
              : 'Late Night '
        : '';

      const playlistName = `${timePrefix}${mood.charAt(0).toUpperCase() + mood.slice(1)} Vibes`;
      const playlistDescription = `${config.description} Created at ${now.toLocaleString()}`;

      // Create the playlist
      const playlist = await handleSpotifyRequest(async (spotifyApi) => {
        const me = await spotifyApi.currentUser.profile();
        return await spotifyApi.playlists.createPlaylist(me.id, {
          name: playlistName,
          description: playlistDescription,
          public: false,
        });
      });

      // Add tracks to playlist
      const trackUris = tracks.map((track) => `spotify:track:${track.id}`);
      await handleSpotifyRequest(async (spotifyApi) => {
        await spotifyApi.playlists.addItemsToPlaylist(playlist.id, trackUris);
      });

      // Format track list for display
      const trackList = tracks
        .map((track, i) => {
          const artists = track.artists.map((a) => a.name).join(', ');
          return `${i + 1}. "${track.name}" by ${artists} (${formatDuration(track.duration_ms)})`;
        })
        .join('\n');

      return {
        content: [
          {
            type: 'text',
            text: `# 🎵 ${playlistName} Created! 🎵\n\n${config.description}\n\n**Playlist Details:**\n- **Name**: ${playlistName}\n- **Tracks**: ${tracks.length}\n- **Duration**: ${duration}\n- **Time**: ${timeOfDay}\n- **Playlist ID**: ${playlist.id}\n\n**Track List:**\n${trackList}\n\n🎉 Your mood playlist is ready to play! Use the playMusic tool with playlist ID "${playlist.id}" to start listening.`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error creating mood playlist: ${
              error instanceof Error ? error.message : String(error)
            }`,
            isError: true,
          },
        ],
      };
    }
  },
};

// Quick mood boost - plays a single track based on mood
const quickMoodBoost: tool<{
  mood: z.ZodEnum<
    [
      'happy',
      'sad',
      'energetic',
      'chill',
      'focused',
      'romantic',
      'nostalgic',
      'party',
      'workout',
      'sleepy',
    ]
  >;
  deviceId: z.ZodOptional<z.ZodString>;
}> = {
  name: 'quickMoodBoost',
  description: 'Instantly play a single track to match your current mood',
  schema: {
    mood: z.enum(MOODS).describe('The mood you want to boost'),
    deviceId: z
      .string()
      .optional()
      .describe('The Spotify device ID to play on'),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { mood, deviceId } = args;

    try {
      // Pick a fresh track for the mood each time
      const [track] = await findMoodTracks(mood, 1);

      if (!track) {
        return {
          content: [
            {
              type: 'text',
              text: `Sorry, I couldn't find a ${mood} track for you right now. Try a different mood!`,
            },
          ],
        };
      }

      // Use direct REST API call to avoid JSON parsing issues
      const accessToken = await getAccessTokenString();
      const targetDeviceId = deviceId || (await getDefaultDeviceId());

      const url = new URL('https://api.spotify.com/v1/me/player/play');
      if (targetDeviceId) {
        url.searchParams.append('device_id', targetDeviceId);
      }

      const response = await fetch(url.toString(), {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ uris: [`spotify:track:${track.id}`] }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Spotify API error: ${response.status} ${errorText}`);
      }

      const artists = track.artists.map((a) => a.name).join(', ');

      return {
        content: [
          {
            type: 'text',
            text: `${moodConfig[mood].emoji} Playing "${track.name}" by ${artists} to boost your ${mood} mood!`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error playing mood boost track: ${
              error instanceof Error ? error.message : String(error)
            }`,
            isError: true,
          },
        ],
      };
    }
  },
};

// Surprise me tool - completely random mood and playlist
const surpriseMe: tool<{
  duration: z.ZodOptional<z.ZodEnum<['short', 'medium', 'long']>>;
}> = {
  name: 'surpriseMe',
  description:
    'Create a completely random surprise playlist based on a random mood!',
  schema: {
    duration: z
      .enum(['short', 'medium', 'long'])
      .optional()
      .describe(
        'Playlist duration: short (10-15 tracks), medium (20-30 tracks), long (40-50 tracks)',
      ),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const randomMood = MOODS[Math.floor(Math.random() * MOODS.length)];

    // Call the createMoodPlaylist tool with the random mood
    return await createMoodPlaylist.handler(
      { mood: randomMood, duration: args.duration, includeTimeBased: true },
      _extra,
    );
  },
};

export const moodTools = [createMoodPlaylist, quickMoodBoost, surpriseMe];
