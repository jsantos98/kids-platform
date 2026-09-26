// English texts. This dictionary defines the keys: every other language
// must translate every one of them (pt.ts is typed against it, so a
// missing text fails the typecheck). `{name}` marks a value filled in.
export const EN = {
  // ---- the garage ----
  'garage.pageTitle': 'My Little Garage',
  'garage.title': 'My Little Garage',
  'garage.help': 'turn the wheel to choose · press the pedal to go',
  // the game's keys, under the carousel, for the vehicle chosen (keys.ts)
  'keys.lead': 'keys in the game:',
  'keys.steer': 'steer',
  'keys.gas': 'go',
  'keys.brakeReverse': 'brake / reverse',
  'keys.forward': 'fly forward',
  'keys.back': 'fly back',
  'keys.faster': 'faster',
  'keys.slower': 'slower',
  'keys.brake': 'brake',
  'keys.siren': 'siren',
  'keys.camera': 'camera',
  'keys.reset': 'back to the start',
  'keys.garage': 'garage',
  'garage.go': 'GO!',
  'garage.letsGo': "{title}. Let's go!",
  'garage.language': 'Language',

  // ---- the play modes (garage + game) ----
  'mode.truck.title': 'Fire Truck',
  'mode.truck.blurb': 'Put out fires and rescue cats!',
  'mode.police.title': 'Police Car',
  'mode.police.blurb': 'Chase the getaway cars!',
  'mode.ambulance.title': 'Ambulance',
  'mode.ambulance.blurb': 'Help the people who need you!',
  'mode.heliMedical.title': 'Rescue Helicopter',
  'mode.heliMedical.blurb': 'Fly and winch people to safety!',
  'mode.heliPolice.title': 'Police Helicopter',
  'mode.heliPolice.blurb': 'Keep the robbers in your light!',
  'mode.plane.title': 'Plane',
  'mode.plane.blurb': 'Swoop through the sky rings!',
  'mode.boat.title': 'Boat',
  'mode.boat.blurb': 'Sail through the buoy gates!',
  'mode.train.title': 'Train',
  'mode.train.blurb': 'Drive the train to every station!',
  'mode.race.title': 'Kart Race',
  'mode.race.blurb': 'Three laps — race to the flag!',

  // ---- the game page ----
  'city.pageTitle': 'Endless City',
  'city.loadingPanel': 'loading…',
  'city.siren': 'SIREN',
  'city.home': 'back to the garage (Esc)',
  'city.hud': 'island {bx},{by} · {mode} · {kmh} km/h · draw calls {calls} · triangles {tris}',

  // ---- loading ----
  'load.ready': 'Getting ready…',
  'load.island': 'Growing your island…',
  'load.kits': 'Unpacking the toys…',
  'load.streets': 'Laying the streets…',
  'load.almost': 'almost there!',
  'load.about': 'about {s} s',
  'load.done': 'Ready!',
  'load.nextIsland': '🏝️ The next island is on its way… {eta}',

  // ---- scores ----
  'score.runTruck': 'this run: {fires} fires · {cats} rescues',
  'score.totalTruck': 'all time: {fires} 🔥 · {cats} 🐱 saved',
  'score.run': 'this run: {n} ⭐',
  'score.total': 'all time: {n} ⭐',

  // ---- camera ----
  'cam.label': 'CAMERA: {mode}',
  'cam.chase': 'CHASE',
  'cam.high': 'HIGH',
  'cam.cab': 'CAB',

  // ---- calls ----
  'call.fireOut': '🔥 FIRE EXTINGUISHED!',
  'call.catSaved': '🐱 CAT RESCUED!',
  'call.allSafe': '🧑‍🚒 EVERYONE IS SAFE!',
  'call.personSaved': '🆘 PERSON RESCUED!',
  'call.hover': 'HOVER HERE!',
  'call.stop': 'STOP HERE!',
  'call.drive.fire': 'DRIVE TO THE FIRE',
  'call.drive.cat': 'DRIVE TO THE CAT',
  'call.drive.rescue': 'DRIVE TO THE BURNING HOUSE',
  'call.drive.patient': 'DRIVE TO THE PERSON',
  'call.fly.fire': 'FLY TO THE FIRE',
  'call.fly.cat': 'FLY TO THE CAT',
  'call.fly.rescue': 'FLY TO THE BURNING HOUSE',
  'call.fly.patient': 'FLY TO THE PERSON',
  'call.waiting': 'waiting for a call…',
  'call.newCourse': 'new course coming…',
  'call.oops': 'OOPS! ↺',

  // ---- the chase ----
  'chase.caught': '🚓 ROBBER CAUGHT!',
  'chase.runs': 'IT RUNS AWAY — AFTER IT!',
  'chase.light': 'KEEP THE CAR IN YOUR LIGHT!',
  'chase.flyAfter': 'FLY AFTER THE GETAWAY CAR!',
  'chase.behind': 'STAY RIGHT BEHIND IT!',
  'chase.catch': 'CATCH THE GETAWAY CAR!',

  // ---- courses ----
  'course.gates': 'DRIVE THROUGH THE GATES!',
  'course.rings': 'FLY THROUGH THE RINGS!',
  'course.buoys': 'SAIL THROUGH THE BUOYS!',
  'course.gatesDone': '🏁 PATROL DONE!',
  'course.ringsDone': '⭕ ALL RINGS!',
  'course.buoysDone': '🚩 COURSE SAILED!',

  // ---- the train ----
  'train.aboard': 'ALL ABOARD! {people}',
  'train.board': 'STOP AT THE YELLOW BOARD!',
  'train.slow': 'SLOW DOWN…',
  'train.station': 'DRIVE TO THE STATION',
  'train.stop': '🚉 STATION STOP!',

  // ---- the race ----
  'race.go': 'GO!',
  'race.lastLap': '🏁 LAST LAP!',
  'race.lapN': 'LAP {n}!',
  'race.badge': 'LAP {lap}/{laps} · {place}',
  'race.wonRace': '🏆 YOU WON THE RACE!',
  'race.placeRace': '🏁 {place} PLACE — GREAT RACE!',
  'race.won': '🏆 YOU WON!',
  'race.place': '🏁 {place} PLACE!',

  // ---- mission scenes ----
  'scene.wellDone': 'WELL DONE!',
  'scene.caught': '🚓 CAUGHT!',
  'scene.spray': 'SPRAY THE FIRE!',
  'scene.holdStill': 'HOLD STILL…',
  'scene.ladderCat': 'MOVE THE LADDER TO THE CAT!',
  'scene.ladderOops': 'OOPS! HOLD THE LADDER STILL!',
  'scene.ladderPeople': 'MOVE THE LADDER TO THE PEOPLE!',
  'scene.stretcher': 'STEER INTO THE AMBULANCE!',
  'scene.tryAgain': 'OOPS! TRY AGAIN!',
  'scene.winchOver': 'STEER OVER THE PERSON!',
  'scene.winchLower': 'LOWERING…',
  'scene.winchLift': 'LIFTING… HOLD IT STEADY!',

  // ---- the concept dioramas ----
  'diorama.firetruck': 'Fire Truck — City Rescue',
  'diorama.helicopter': 'Rescue Helicopter',
  'diorama.train': 'Little Train Line',
  'diorama.hud': '{name} · seed {seed} · {cam}  ·  draw calls {calls}  ·  triangles {tris}',
  'diorama.name.firetruck': 'fire truck',
  'diorama.name.helicopter': 'rescue helicopter',
  'diorama.name.train': 'little train line',
} as const;

export type Key = keyof typeof EN;
