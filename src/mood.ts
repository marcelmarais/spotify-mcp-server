import { z } from 'zod';
import type { SpotifyHandlerExtra, tool } from './types.js';
import { getDefaultDeviceId, handleSpotifyRequest } from './utils.js';

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
    mood: z
      .enum([
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
      ])
      .describe('The mood you want the playlist to reflect'),
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

    // Get current time for time-based recommendations
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

    // Define mood-based seed tracks and genres
    const moodConfig = {
      happy: {
        genres: ['pop', 'indie-pop', 'dance', 'funk'],
        seedTracks: [
          '60nZcImufyMA1MKQY3dcCH',
          '1mea3bSkSGXuIRvnydlB5b',
          '0VjIjW4WU7z59J0L1QpNnp',
        ],
        description: 'Upbeat and cheerful tracks to brighten your day! 🌟',
      },
      sad: {
        genres: ['indie', 'folk', 'acoustic', 'alternative'],
        seedTracks: [
          '4uLU6hMCjMI75M1A2tKUQC',
          '1mea3bSkSGXuIRvnydlB5b',
          '0VjIjW4WU7z59J0L1QpNnp',
        ],
        description:
          'Melancholic and introspective songs for when you need to feel understood 💙',
      },
      energetic: {
        genres: ['rock', 'electronic', 'dance', 'pop'],
        seedTracks: [
          '3gVhsZtseYtY1fMuyYq06F',
          '4iV5W9uYEdYUVa79Axb7Rh',
          '1mea3bSkSGXuIRvnydlB5b',
        ],
        description: 'High-energy tracks to get your blood pumping! ⚡',
      },
      chill: {
        genres: ['ambient', 'indie', 'jazz', 'lounge'],
        seedTracks: [
          '0VjIjW4WU7z59J0L1QpNnp',
          '4uLU6hMCjMI75M1A2tKUQC',
          '1mea3bSkSGXuIRvnydlB5b',
        ],
        description: 'Relaxed and mellow vibes for unwinding 🧘‍♀️',
      },
      focused: {
        genres: ['instrumental', 'ambient', 'classical', 'electronic'],
        seedTracks: [
          '0VjIjW4WU7z59J0L1QpNnp',
          '4uLU6hMCjMI75M1A2tKUQC',
          '1mea3bSkSGXuIRvnydlB5b',
        ],
        description: 'Concentration-friendly tracks to boost productivity 🎯',
      },
      romantic: {
        genres: ['r&b', 'soul', 'indie', 'pop'],
        seedTracks: [
          '4uLU6hMCjMI75M1A2tKUQC',
          '0VjIjW4WU7z59J0L1QpNnp',
          '1mea3bSkSGXuIRvnydlB5b',
        ],
        description: 'Intimate and romantic songs for special moments 💕',
      },
      nostalgic: {
        genres: ['indie', 'folk', 'alternative', 'rock'],
        seedTracks: [
          '4uLU6hMCjMI75M1A2tKUQC',
          '0VjIjW4WU7z59J0L1QpNnp',
          '1mea3bSkSGXuIRvnydlB5b',
        ],
        description: 'Songs that take you back to cherished memories 📸',
      },
      party: {
        genres: ['dance', 'pop', 'electronic', 'hip-hop'],
        seedTracks: [
          '3gVhsZtseYtY1fMuyYq06F',
          '4iV5W9uYEdYUVa79Axb7Rh',
          '1mea3bSkSGXuIRvnydlB5b',
        ],
        description:
          'High-energy party anthems to get the celebration started! 🎉',
      },
      workout: {
        genres: ['rock', 'electronic', 'hip-hop', 'pop'],
        seedTracks: [
          '3gVhsZtseYtY1fMuyYq06F',
          '4iV5W9uYEdYUVa79Axb7Rh',
          '1mea3bSkSGXuIRvnydlB5b',
        ],
        description: 'Motivational tracks to power through your workout! 💪',
      },
      sleepy: {
        genres: ['ambient', 'classical', 'indie', 'acoustic'],
        seedTracks: [
          '0VjIjW4WU7z59J0L1QpNnp',
          '4uLU6hMCjMI75M1A2tKUQC',
          '1mea3bSkSGXuIRvnydlB5b',
        ],
        description:
          'Gentle and soothing songs to help you drift off to sleep 🌙',
      },
    };

    const config = moodConfig[mood];
    const trackCount =
      duration === 'short' ? 15 : duration === 'medium' ? 25 : 45;

    try {
      // Get recommendations based on mood
      const recommendations = await handleSpotifyRequest(async (spotifyApi) => {
        return await spotifyApi.recommendations.get({
          seed_tracks: config.seedTracks,
          limit: trackCount,
          target_energy:
            mood === 'energetic' || mood === 'party' || mood === 'workout'
              ? 0.8
              : mood === 'chill' || mood === 'sleepy' || mood === 'focused'
                ? 0.3
                : 0.5,
          target_valence:
            mood === 'happy' || mood === 'party'
              ? 0.8
              : mood === 'sad' || mood === 'nostalgic'
                ? 0.2
                : 0.5,
          target_danceability:
            mood === 'party' || mood === 'workout'
              ? 0.8
              : mood === 'focused' || mood === 'sleepy'
                ? 0.3
                : 0.5,
        });
      });

      if (recommendations.tracks.length === 0) {
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
      const trackUris = recommendations.tracks.map(
        (track) => `spotify:track:${track.id}`,
      );
      await handleSpotifyRequest(async (spotifyApi) => {
        await spotifyApi.playlists.addItemsToPlaylist(playlist.id, trackUris);
      });

      // Format track list for display
      const trackList = recommendations.tracks
        .map((track, i) => {
          const artists = track.artists.map((a) => a.name).join(', ');
          const duration = Math.floor(track.duration_ms / 60000);
          return `${i + 1}. "${track.name}" by ${artists} (${duration}:${String(Math.floor((track.duration_ms % 60000) / 1000)).padStart(2, '0')})`;
        })
        .join('\n');

      return {
        content: [
          {
            type: 'text',
            text: `# 🎵 ${playlistName} Created! 🎵\n\n${config.description}\n\n**Playlist Details:**\n- **Name**: ${playlistName}\n- **Tracks**: ${recommendations.tracks.length}\n- **Duration**: ${duration}\n- **Time**: ${timeOfDay}\n- **Playlist ID**: ${playlist.id}\n\n**Track List:**\n${trackList}\n\n🎉 Your mood playlist is ready to play! Use the playMusic tool with playlist ID "${playlist.id}" to start listening.`,
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
    mood: z
      .enum([
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
      ])
      .describe('The mood you want to boost'),
    deviceId: z
      .string()
      .optional()
      .describe('The Spotify device ID to play on'),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { mood, deviceId } = args;

    // Use provided deviceId, or default device, or empty string
    const targetDeviceId = deviceId || (await getDefaultDeviceId()) || '';

    // Quick mood-based track selection
    const moodTracks = {
      happy: '60nZcImufyMA1MKQY3dcCH', // Pharrell Williams - Happy
      sad: '4uLU6hMCjMI75M1A2tKUQC', // Example sad track
      energetic: '3gVhsZtseYtY1fMuyYq06F', // Example energetic track
      chill: '0VjIjW4WU7z59J0L1QpNnp', // Example chill track
      focused: '1mea3bSkSGXuIRvnydlB5b', // Example focused track
      romantic: '4uLU6hMCjMI75M1A2tKUQC', // Example romantic track
      nostalgic: '0VjIjW4WU7z59J0L1QpNnp', // Example nostalgic track
      party: '3gVhsZtseYtY1fMuyYq06F', // Example party track
      workout: '4iV5W9uYEdYUVa79Axb7Rh', // Example workout track
      sleepy: '0VjIjW4WU7z59J0L1QpNnp', // Example sleepy track
    };

    const trackId = moodTracks[mood];

    try {
      await handleSpotifyRequest(async (spotifyApi) => {
        await spotifyApi.player.startResumePlayback(targetDeviceId, undefined, [
          `spotify:track:${trackId}`,
        ]);
      });

      const moodEmojis = {
        happy: '😊',
        sad: '😢',
        energetic: '⚡',
        chill: '🧘‍♀️',
        focused: '🎯',
        romantic: '💕',
        nostalgic: '📸',
        party: '🎉',
        workout: '💪',
        sleepy: '🌙',
      };

      return {
        content: [
          {
            type: 'text',
            text: `${moodEmojis[mood]} Playing a ${mood} track to boost your mood! The music should start playing on your device now.`,
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
    const moods = [
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
    const randomMood = moods[Math.floor(Math.random() * moods.length)];

    // Call the createMoodPlaylist tool with the random mood
    return await createMoodPlaylist.handler(
      { mood: randomMood, duration: args.duration, includeTimeBased: true },
      _extra,
    );
  },
};

export const moodTools = [createMoodPlaylist, quickMoodBoost, surpriseMe];
