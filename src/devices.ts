import { handleSpotifyRequest } from './utils.js';

export const getAvailableDevices = {
  name: 'devices',
  description: 'Get a list of available Spotify devices',
  schema: {},
  handler: async () => {
    const result = await handleSpotifyRequest(async (spotifyApi) => {
      return await spotifyApi.player.getAvailableDevices();
    });

    return {
      content: [
        {
          type: 'text',
          text: `Available devices: ${result.devices
            .map((d) => `\n- ${d.name} (${d.id})`)
            .join('')}`,
        },
      ],
    };
  },
};

export const deviceTools = [getAvailableDevices];
