// The game's music (G12): one list, read by the recorder (tools/make-music.py
// — ElevenLabs' music generation, from these prompts, into
// public/audio/music/<id>.ogg, each cut into a seamless loop of whole bars)
// and by the game (engine/audio.ts setMusic), which crossfades from one to
// the next as the moment changes.

export interface MusicDef {
  /** what to ask for (English works best); every prompt asks for a steady
   * groove without an intro, an ending or a fade, so a long loop can be cut */
  prompt: string;
  /** the tempo the prompt asks for — the recorder checks the loop against it */
  bpm: number;
  /** its length (s) — ElevenLabs charges per minute (~900 credits) */
  seconds: number;
}

const LOOP = 'instrumental, steady groove from the first beat to the last, no intro, no ending, no fade, made to loop';

export const MUSIC = {
  // the garage: choosing a vehicle
  garage: { prompt: `Cheerful, bouncy music for a children's game menu, a toy garage full of vehicles: ukulele, glockenspiel, handclaps, light drums, playful bass, major key, 110 BPM, ${LOOP}`, bpm: 110, seconds: 60 },
  // driving (and flying, sailing, riding the train) round the island
  day: { prompt: `Sunny, upbeat adventure music for a children's driving game, exploring a little island city by day: acoustic guitar strums, bright piano, marimba melody, bouncy bass, light drums with shaker, major key, happy and carefree, 118 BPM, ${LOOP}`, bpm: 118, seconds: 120 },
  night: { prompt: `Calm, warm night-time music for a children's driving game, a little city lit up under the stars: soft electric piano, music box and celesta twinkles, gentle pads, soft brushed drums, round bass, major key, dreamy but still moving along, 92 BPM, ${LOOP}`, bpm: 92, seconds: 120 },
  // the race islands
  race: { prompt: `Energetic, exciting race music for a children's kart racing game: driving drums, funky bass, bright synth brass stabs, electric guitar riffs, major key, fun and fast but never aggressive, 150 BPM, ${LOOP}`, bpm: 150, seconds: 90 },
  // the police car and the police helicopter chasing the getaway cars
  chase: { prompt: `Playful cartoon police-chase music for a children's game, sneaky and fun: pizzicato strings, walking upright bass, bongos and snare, cheeky clarinet and muted trumpet melody, spy-caper feel, light-hearted, 128 BPM, ${LOOP}`, bpm: 128, seconds: 90 },
  // a mission's own scene: the fire, the cat, the patient, the rescue
  scene: { prompt: `Brave, hopeful little-hero music for a children's rescue mission, putting out a fire and saving a kitten: light marching snare, bright brass and strings, glockenspiel, determined but cheerful, major key, 112 BPM, ${LOOP}`, bpm: 112, seconds: 60 },
} satisfies Record<string, MusicDef>;

export type MusicId = keyof typeof MUSIC;
