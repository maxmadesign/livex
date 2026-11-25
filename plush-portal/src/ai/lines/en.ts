import type { LangBank } from './types';

/** Momo's built-in English lines (original text, roughly 8–20 words each). */
export const en: LangBank = {
  toyFallback: 'this cutie',
  dir: {
    left: 'to the left',
    right: 'to the right',
    back: 'toward the back',
    front: 'toward the front',
    left_back: 'to the left and toward the back',
    left_front: 'to the left and toward the front',
    right_back: 'to the right and toward the back',
    right_front: 'to the right and toward the front',
  },
  lines: {
    welcome: {
      all: [
        ["Hi, I'm Momo! Pick a plush you like and let's catch it together.", 'happy'],
        ['Welcome to Plush Portal! Move the claw over a cutie and press grab.', 'happy'],
        ['Hello hello! The plushies are waiting. Ready to give the claw a try?', 'happy'],
        ["Momo here! Take your time aiming, I'll cheer for every single grab.", 'happy'],
      ],
      sakura: [
        ['Welcome to the sakura shop! Which fluffy friend catches your eye today?', 'happy'],
        ['Petals are falling and plushies are waiting. Shall we play a round?', 'calm'],
      ],
      storybook: [
        ['Welcome, adventurer! A whole toy box of friends is waiting behind the glass.', 'happy'],
        ['Once upon a time, a brave little claw met a pile of plush friends.', 'calm'],
      ],
      ocean: [
        ["Welcome to the ocean dream! Let's dive in and scoop up a sea friend.", 'happy'],
        ['Splash! The tide just brought in new plushies. Want to catch one?', 'happy'],
      ],
      cosmic: [
        ['Welcome aboard the cosmic arcade! Steer the claw and catch a little star.', 'happy'],
        ['Three, two, one, launch! Space plushies are floating by, go grab one.', 'cheer'],
      ],
      gpu: [
        ['Welcome to the GPU Party! The fans are spinning and the plushies are ready to render.', 'happy'],
        ["Boot sequence complete! Pick a plush from the server rack and let's start the show.", 'cheer'],
      ],
      gtc: [
        ["Welcome to {event}! I'm Momo, your plush booth host. Pick a plush and let's play.", 'happy'],
        ['Hi there, {event} explorer! Between keynote buzz and session hopping, take a claw break with me.', 'happy'],
        ['Welcome to our plush booth at {host} {event}! The claw is warmed up and ready for you.', 'cheer'],
        ['Fresh from the exhibit hall? Catch a plush and take home a little {event} memory.', 'happy'],
      ],
    },
    first_play: {
      all: [
        ['Use the joystick to line up the claw, then press the big grab button.', 'calm'],
        ['Left and right slide the claw. Up sends it back, down brings it closer.', 'calm'],
        ['First try! Park the claw right above a plush, then press grab.', 'happy'],
        ['Tip for round one: aim for the middle of the body, not the ears.', 'think'],
      ],
      sakura: [['First round in the sakura shop: line up above a plush and grab gently.', 'calm']],
      storybook: [['Chapter one: steer the claw over a friend and press grab to begin.', 'calm']],
      ocean: [['First dive! Float the claw above a sea friend, then press grab.', 'happy']],
      cosmic: [['First mission! Steer above your target, then press grab for touchdown.', 'happy']],
      gpu: [['First benchmark! Line the claw up over a plush, then press grab to run it.', 'happy']],
      gtc: [
        ['Think of this as a hands-on lab: the joystick aims, then press grab to run it.', 'calm'],
        ['Your first {event} lab session! Steer with the joystick, then the grab button runs the experiment.', 'happy'],
        ['Quick booth demo: the joystick moves the claw, and the big button sends it down.', 'calm'],
      ],
    },
    idle: {
      all: [
        ['Still choosing? Try a plush sitting on top, those are easier to lift.', 'think'],
        ['No rush! Move the claw around and see which plush looks easiest.', 'calm'],
        ['Psst, the ones near the front are simpler to line up.', 'think'],
        ["Want a hint? Look for a plush that isn't squeezed between the others.", 'think'],
        ["Take your time. Nudge the joystick whenever you're ready to aim.", 'calm'],
      ],
      sakura: [["The petals can wait. Pick a fluffy friend to chase whenever you're ready.", 'calm']],
      storybook: [['Every story needs a hero. Which friend will you rescue first?', 'think']],
      ocean: [['The tide is calm right now, a perfect moment to line up.', 'calm']],
      cosmic: [["The stars are drifting slowly. Lock onto a target whenever you're ready, captain.", 'calm']],
      gpu: [['The fans are humming along. Take your time picking the next target, no lag here.', 'calm']],
      gtc: [
        ['Browsing like it is the exhibit hall? Plushies on top of the pile are easier to lift.', 'think'],
        ['No rush, this booth runs on your schedule. Move the claw whenever you are ready.', 'calm'],
        ['Taking a breather between talks? The plush nearest the front is the simplest to line up.', 'think'],
      ],
    },
    'idle.tracking': {
      all: [
        ['Want another angle? Lean a little left or right and peek inside.', 'think'],
        ['Try moving your head a bit. The view shifts so you can judge the depth.', 'think'],
        ['Lean sideways to see how far back the claw really is.', 'think'],
      ],
      gtc: [
        ['Lean left or right, like walking around a demo in the exhibit hall.', 'think'],
        ['Move your head a little. The view shifts, just like a 3D demo on the show floor.', 'think'],
      ],
    },
    aim: {
      all: [
        ["Line the claw up over the plush's tummy before you drop it.", 'think'],
        ["See the ring on the toys? That's exactly where the claw will land.", 'think'],
        ['Up moves the claw toward the back, down brings it toward you.', 'calm'],
        ['Aim for the widest part of the body so all three fingers can hug it.', 'think'],
        ['Small taps help! Nudge the claw until the ring sits on your target.', 'think'],
      ],
      sakura: [['Hover right over the fluffiest part. Soft tummies are the easiest to hold.', 'think']],
      storybook: [["Steady now, hero. Centre the claw over your friend's belly.", 'think']],
      ocean: [['Drift the claw above the roundest part, like a bubble settling down.', 'think']],
      cosmic: [['Lock on! Centre the target ring on the plush before you descend.', 'think']],
      gpu: [['Calibrating! Centre the target ring on the plush, pixel-perfect, before you drop.', 'think']],
      gtc: [
        ['Centre the ring on the middle of the plush. Precision tuning, like a well-optimised kernel.', 'think'],
        ['Treat it like a poster session: look up close, then centre the ring on the tummy.', 'think'],
        ['Hands-on lab rule: centre the ring so three fingers grip in parallel, CUDA style.', 'think'],
      ],
    },
    grab: {
      all: [
        ['Here we go! Down, down, down. Hold on tight, little claw!', 'cheer'],
        ["Nice aim! Let's see what the claw can hug.", 'cheer'],
        ['And drop! Come on, little claw, wrap those fingers around it!', 'cheer'],
        ['Ooh, that spot looks promising. Come on, claw, you can do it!', 'cheer'],
        ["Going down! Let's see if those fingers can wrap around it.", 'cheer'],
      ],
      sakura: [['Down it goes, soft as a petal. Now grab on tight!', 'cheer']],
      storybook: [['The claw swoops in! Will our hero make the rescue?', 'cheer']],
      ocean: [["Diving down! Let's scoop up a friend from the deep.", 'cheer']],
      cosmic: [['Descent started! Landing gear out, steady, steady, steady.', 'cheer']],
      gpu: [['Executing grab! The claw is processing at full speed, hold on tight.', 'cheer']],
      gtc: [
        ['Claw launched! Three fingers working in parallel, like a tiny CUDA kernel.', 'cheer'],
        ['Live demo time! Down goes the claw. Hold on tight, little fingers!', 'cheer'],
        ['Accelerated grabbing in progress! Every finger is computing a hug right now.', 'cheer'],
      ],
    },
    'empty.dir': {
      all: [
        ['Missed that one. Try moving the claw a bit more {dir} next time.', 'think'],
        ['Nothing there this time. The nearest plush was a little {dir}.', 'think'],
        ["Empty claw! Slide a little {dir} and you'll be directly above {near}.", 'think'],
        ['Not quite lined up. Go a bit further {dir} before you drop.', 'think'],
        ['The claw landed in a gap. Aim slightly {dir} to cover a plush.', 'oops'],
      ],
      gtc: [
        ['Empty claw this time. Shift a little {dir}, like heading to the next booth.', 'think'],
        ['No plush in that batch. Nudge the claw {dir} and run it once more.', 'think'],
        ['The claw landed in an empty aisle. Go a bit more {dir} and {near} is waiting.', 'oops'],
      ],
    },
    'empty.none': {
      all: [
        ['Nothing under the claw that time. Line the ring up on a plush first.', 'think'],
        ['Empty grab! Check the target ring before you press the button.', 'oops'],
        ['The claw found only air. Aim right over a plush and try again?', 'oops'],
      ],
      gtc: [
        ['Only air in that grab. Put the target ring on a plush before you run it.', 'think'],
        ['Empty grab! Even the best demo needs a target, so line up the ring first.', 'oops'],
        ['No plush under the claw that time. Check the ring, then give it another run.', 'think'],
      ],
    },
    'empty.touched': {
      all: [
        ['So close, the claw touched it! Aim a bit more over the middle.', 'oops'],
        ["It brushed the plush but couldn't hold on. Centre it and try again?", 'oops'],
        ['Almost! The fingers need the body between them, so line up the tummy.', 'think'],
        ['You touched it! A tiny nudge toward the centre should help the grip.', 'think'],
        ['Just a brush that time. Try dropping right over the widest part.', 'think'],
      ],
      gtc: [
        ["So close, that was real contact! One small centring tweak and it's a fresh run.", 'oops'],
        ['Almost! It brushed the plush. Optimise your aim toward the middle and try again.', 'oops'],
        ['You made contact! A final tweak toward the centre, like tuning before a big demo.', 'think'],
      ],
    },
    'slip.eccentric': {
      all: [
        ['It was only holding on by the edge. Grab closer to the middle of the body.', 'oops'],
        ['So close! The grip was off-centre. Aim right over the tummy next time.', 'oops'],
        ['It tipped out sideways. Centre the claw on the plush and try again?', 'think'],
      ],
      gtc: [
        ['An edge-only grip, so it wobbled out. Aim for the core of the body next run.', 'oops'],
        ['Off-centre grip, so close! Next run, park the claw right over the tummy.', 'oops'],
        ['It tipped out sideways. Put the claw centre stage, like a keynote spotlight, and retry?', 'think'],
      ],
    },
    'slip.weak_support': {
      all: [
        ['Only two fingers got under it. Try the widest part of the body.', 'think'],
        ['It needed one more finger underneath! Aim so the claw hugs it evenly.', 'oops'],
        ['The hold was a bit thin. Drop over the centre so every finger wraps around.', 'think'],
      ],
      gtc: [
        ['Only two fingers got under it. Three working in parallel hold much better.', 'think'],
        ['Short on fingers that time. Land over the widest part so all three share the workload.', 'oops'],
        ['It needed one more finger underneath! Spread the load like a well-balanced cluster.', 'think'],
      ],
    },
    'slip.contact_lost': {
      all: [
        ['The fingers lost their hold on the way up. A centred grab stays put.', 'oops'],
        ['It wriggled free! Try catching it lower, around the body.', 'oops'],
        ['Almost had it, then the grip let go. Aim for the round middle next time.', 'think'],
      ],
      gtc: [
        ['The grip dropped on the way up, like a lost connection. Aim for the round middle.', 'oops'],
        ['It wriggled free during the lift! A centred grab keeps the link steady.', 'oops'],
        ['Contact lost during the climb! Grab lower around the body for a solid link.', 'think'],
      ],
    },
    'slip.transport_swing': {
      all: [
        ['It swung loose on the ride over. So close! A centred grab swings less.', 'oops'],
        ['Whoa, the swing shook it off! You did lift it though, nicely done.', 'oops'],
        ['It slipped during the trip to the chute. Almost there, want to try once more?', 'oops'],
      ],
      gtc: [
        ['It swung loose on the way to the chute. You did lift it though, benchmark-worthy!', 'oops'],
        ['So close! The ride over shook it off. A centred grip swings much less.', 'oops'],
        ['It slipped mid-delivery, like a badge falling off a lanyard. Centre it and try again?', 'oops'],
      ],
    },
    'slip.overload': {
      all: [
        ['That one was heavy for the claw! Try a smaller plush or a more centred hug.', 'oops'],
        ['Too much to hold that time. Grab around the middle for a stronger grip.', 'think'],
        ["The claw couldn't carry it. A centred hold spreads the weight much better.", 'think'],
      ],
      gtc: [
        ['That plush was a heavy workload! Pick a lighter one or balance the grip in the centre.', 'oops'],
        ['Too much load for one grip. Hug it around the middle so every finger carries a share.', 'think'],
        ['The claw maxed out on that one. A centred hold balances the load much better.', 'think'],
      ],
    },
    'slip.bounced_out': {
      all: [
        ['It bounced off the rim of the chute! So close, you carried it all the way.', 'oops'],
        ['Oh no, it hopped off the edge at the last second. That was a great carry!', 'oops'],
        ["It landed on the chute's rim and rolled back. Almost there, try once more?", 'oops'],
      ],
      gtc: [
        ["It bounced off the chute's rim at the very end! So close, what a carry.", 'oops'],
        ['Oh no, a last-second hop out of the chute! That run was keynote material though.', 'oops'],
        ['Rolled back off the rim, so close to delivery! Want to run it once more?', 'oops'],
      ],
    },
    'slip.generic': {
      all: [
        ['You had it for a moment! Try a little closer to the middle.', 'oops'],
        ['So close, it slipped right out. Centre the claw and go again?', 'oops'],
        ['It got away this time, but that was a real grab. Nice work!', 'happy'],
      ],
      gtc: [
        ['It was in your grip for a moment! Refine the plan and aim nearer the middle.', 'oops'],
        ['It got away, but that was a real grab. A great story for the coffee break!', 'happy'],
        ['Mid-run slip, so close! Debug the aim toward the centre and ship another try?', 'oops'],
      ],
    },
    win: {
      all: [
        ['You got it! {toy} is joining your collection.', 'cheer'],
        ['Yay! {toy} made it into the chute. Great catch!', 'cheer'],
        ['Woohoo! {toy} is yours. That was a lovely grab.', 'cheer'],
        ['Caught it! {toy} looks so happy to go home with you.', 'happy'],
        ['Perfect drop! {toy} is safely in the prize bin.', 'cheer'],
      ],
      sakura: [
        ["{toy} floated down like a petal, and now it's yours!", 'cheer'],
        ['Sweet catch! {toy} is the cutest thing in the shop today.', 'happy'],
      ],
      storybook: [
        ['And so {toy} was rescued. What a happy ending!', 'cheer'],
        ['Bravo, hero! {toy} joins your band of friends.', 'cheer'],
      ],
      ocean: [
        ['Splash! {toy} swam straight into your collection.', 'cheer'],
        ['What a catch! {toy} rode the wave right to you.', 'cheer'],
      ],
      cosmic: [
        ['Touchdown! {toy} has landed safely in your collection.', 'cheer'],
        ['Stellar grab! {toy} just joined your crew.', 'cheer'],
      ],
      gpu: [
        ['Render complete! {toy} has been delivered to your collection.', 'cheer'],
        ['Full frame rate catch! {toy} is coming home with you.', 'cheer'],
      ],
      gtc: [
        ['You got it! {toy} is coming home with you, the best souvenir of {event}.', 'cheer'],
        ['Catch complete! {toy} heads from the {event} show floor straight into your collection.', 'cheer'],
        ['A showcase-worthy catch! {toy} takes a bow and joins your collection.', 'cheer'],
        ['Accelerated catch! {toy} dropped into the chute right on time.', 'happy'],
      ],
    },
    'win.new': {
      all: [
        ['A brand-new friend! {toy} is in your collection for the first time.', 'cheer'],
        ['New discovery! {toy} just unlocked in your collection.', 'cheer'],
        ['First time catching {toy}! Your collection is growing.', 'cheer'],
        ['Ooh, a new one! Say hello to {toy}, your latest friend.', 'happy'],
      ],
      sakura: [['A new blossom for your collection. Welcome, {toy}!', 'cheer']],
      storybook: [['A new character joins the story. Welcome, {toy}!', 'cheer']],
      ocean: [['A new sea friend just surfaced. Welcome aboard, {toy}!', 'cheer']],
      cosmic: [['New star discovered! {toy} is now on your star map.', 'cheer']],
      gpu: [['New hardware unlocked! {toy} just joined your collection for the first time.', 'cheer']],
      gtc: [
        ['New in your collection: {toy}! A fresh discovery from the {event} show floor.', 'cheer'],
        ['{toy} just joined your collection for the very first time. What a debut!', 'cheer'],
        ['A new face in the lineup! {toy} is your freshest {event} discovery.', 'happy'],
      ],
    },
    'win.reward': {
      all: [
        ['You got {toy}! Scan the QR code to claim your plush prize or a swag discount.', 'cheer'],
        ['Winner! Scan the code on screen with your phone and pick your prize or a swag discount.', 'cheer'],
      ],
      gtc: [
        ['{toy} is yours! Scan the QR code: pick up your plush at the booth or unlock swag savings.', 'cheer'],
        ['{event} winner! Point your phone at the QR code and choose a plush prize or a swag discount.', 'cheer'],
        ['Winner! Grab your phone, scan the QR code and choose a plush prize or swag savings.', 'cheer'],
      ],
    },
    'win.reward.prize': {
      all: [
        ['You got {toy}! Scan the QR code with your phone to claim your plush prize.', 'cheer'],
        ['Winner! Scan the code on screen to collect your prize.', 'cheer'],
      ],
      gtc: [
        ['Prize unlocked, {toy} catcher! Scan the QR code and pick up your plush at the booth.', 'cheer'],
        ['{event} winner! Scan the QR code, then bring your phone to the booth for your plush prize.', 'cheer'],
      ],
    },
    'win.reward.swag': {
      all: [
        ['You got {toy}! Scan the QR code with your phone for a swag discount.', 'cheer'],
        ['Winner! Scan the code on screen to unlock your swag discount.', 'cheer'],
      ],
      gtc: [
        ['Nice catch, {event} friend! That QR code holds your swag discount, so scan it now.', 'cheer'],
        ['{event} winner! Swag savings unlocked: scan the QR code with your phone.', 'cheer'],
      ],
    },
    'win.demo': {
      all: [
        ['That was just a demo catch. Tap start and try it yourself!', 'happy'],
        ["See how it's done? The demo doesn't count, so now it's your turn.", 'happy'],
        ['Demo win! Press start to catch one for your own collection.', 'happy'],
      ],
      gtc: [
        ["That was a booth demo, so it doesn't count. Press start and try it hands-on!", 'happy'],
        ["Demo complete! Now it's your turn for the hands-on version. Tap start to play.", 'happy'],
        ['Like every good {event} demo, now you try it yourself. Press start for a real round.', 'happy'],
      ],
    },
    'miss.demo': {
      all: [
        ["Even the demo misses sometimes! Want to show it how it's done?", 'happy'],
        ['Demo round over. Tap start whenever you want to play for real.', 'calm'],
      ],
      gtc: [
        ['Even live demos miss sometimes! Tap start and run the hands-on version yourself.', 'happy'],
        ['Demo round over. Ready for your hands-on lab? Press start to play for real.', 'calm'],
      ],
    },
    theme: {
      all: [
        ['New look, new friends! Have a peek at who is waiting inside.', 'happy'],
        ['The cabinet just changed its outfit. Let me introduce the new plushies!', 'happy'],
      ],
      sakura: [
        ['Sakura Kawaii it is! Soft pinks, falling petals and the fluffiest friends.', 'happy'],
        ['Welcome to the sakura shop, where everything is extra soft.', 'calm'],
        ["Spring mode on! Let's find a cuddly friend among the petals.", 'happy'],
      ],
      storybook: [
        ['Storybook Friends! A toy box full of characters ready for adventure.', 'happy'],
        ['A new chapter begins. Who will be the hero of your story?', 'think'],
        ['Welcome to the storybook, where every plush has a tale to tell.', 'calm'],
      ],
      ocean: [
        ['Ocean Dream! Calm waves, soft lights and squishy sea friends.', 'calm'],
        ["Deep breath, we're diving in. So many ocean friends to meet!", 'happy'],
        ["The tide rolled in a whole new crew. Let's go fishing, gently!", 'happy'],
      ],
      cosmic: [
        ['Cosmic Arcade! Neon stars and space buddies are waiting, captain.', 'cheer'],
        ['Blast off! A galaxy of plush explorers is floating by.', 'cheer'],
        ['Welcome to orbit. Catch a star before it drifts away!', 'happy'],
      ],
      gpu: [
        ['GPU Party! Green lights, whirring fans and the cutest little chips in town.', 'cheer'],
        ['The keynote stage is lit. Graphics cards, robots and pixel cubes are waiting!', 'happy'],
        ['Welcome to the plush tech expo. Every cooling fan is spinning just for you.', 'happy'],
      ],
      gtc: [
        ['Welcome to {host} {event}! Black, white, {host} green and a booth full of plush.', 'cheer'],
        ['We are on the {event} show floor! Keynote energy, live demos and plushies to catch.', 'happy'],
        ['{event} mode on! Sessions, hands-on labs, the startup showcase and one very cute claw machine.', 'cheer'],
        ['Hello, developers! This booth runs on accelerated cuteness. Pick a plush to start.', 'happy'],
      ],
    },
    retry: {
      all: [
        ["Want another go? No pressure, the plushies aren't going anywhere.", 'calm'],
        ["One more try? You can also just watch for a bit, that's fine too.", 'calm'],
        ['Ready when you are! Every grab gives you a better feel for the claw.', 'happy'],
        ['Fancy another round? Take a breath and pick your favourite.', 'happy'],
      ],
      sakura: [['Another round among the petals? Whenever you feel like it.', 'calm']],
      storybook: [['Shall we turn the page and try another round?', 'happy']],
      ocean: [['The tide always comes back around. Want to cast the claw again?', 'calm']],
      cosmic: [['Ready for another orbit? Launch whenever you like, captain.', 'happy']],
      gpu: [['Ready for another run? Reboot the claw whenever you like, no pressure.', 'happy']],
      gtc: [
        ['Another run? Like any good lab, every try teaches you more about the claw.', 'happy'],
        ['Ready for round two? No pressure, you can catch a session and come back later.', 'calm'],
        ['One more go before your next talk? The plushies will be right here.', 'happy'],
      ],
    },
    'retry.streak': {
      all: [
        ['Tricky pile today! Try a plush that sits on top with space around it.', 'think'],
        ["Let's switch targets. Pick one near the front that isn't squeezed in.", 'think'],
        ["You're getting closer each time. Aim for a round tummy, right in the middle.", 'think'],
        ['Tough streak! A fresh angle might help, or take a little break.', 'calm'],
      ],
      gtc: [
        ['Tricky pile today! Time to debug: target a plush up top with room around it.', 'think'],
        ["Iterate like a developer: switch to a plush that isn't squeezed in.", 'think'],
        ['Tough streak! Grab a coffee, chat with a developer, then come back fresh.', 'calm'],
      ],
    },
    'retry.reward': {
      all: [
        ['Your claim code is still on screen. Scan it with your phone before you play again!', 'happy'],
        ["Don't forget the QR code! Scan it before it disappears, then play another round.", 'happy'],
      ],
      gtc: [
        ['Before your next session, scan that QR code! Your {event} claim is waiting.', 'happy'],
        ['Your QR code is still up. Scan it with your phone, then catch another round.', 'happy'],
      ],
    },
    tip: {
      all: [
        ['Aim for the middle of the body so all three fingers can wrap around.', 'think'],
        ['Plushies on top of the pile are easier than ones wedged underneath.', 'think'],
        ['Watch the target ring. It shows exactly where the claw will land.', 'think'],
        ['Use small taps to fine-tune. Up is toward the back, down is toward you.', 'think'],
        ['Round bodies hold better than ears or tails, so go for the tummy.', 'think'],
        ['A centred grab swings less on the way to the chute.', 'think'],
      ],
      sakura: [['Pick the roundest, fluffiest friend. Round shapes sit nicely in the claw.', 'think']],
      storybook: [["Heroes aim for the belly. That's where the claw holds best.", 'think']],
      ocean: [['Round sea friends are easiest. Tentacles and fins tend to slip away.', 'think']],
      cosmic: [['Lock onto round bodies, captain. Antennas and ears are slippery.', 'think']],
      gpu: [
        ['Chunky shapes like cubes and chips sit nicely in the claw. Aim for the middle.', 'think'],
        ['Thin fan blades and cables slip easily. Go for the solid body instead.', 'think'],
      ],
      gtc: [
        ['Pro tip from the booth: aim for the middle so all three fingers work in parallel.', 'think'],
        ['Chunky shapes like chips and cubes sit nicely in the claw. Go for the solid body.', 'think'],
        ['Look closely, like at a poster session, then centre the ring on the tummy.', 'think'],
      ],
    },
    'tip.tracking': {
      all: [
        ['Lean left or right to peek around. It helps you judge the depth.', 'think'],
        ['Move your head a little and watch the toys shift. Nearer ones move more.', 'think'],
      ],
      gtc: [
        ['Lean left or right to peek around, like circling a demo on the show floor.', 'think'],
        ['Move your head a little. Nearer plushies shift more, so you can judge the depth.', 'think'],
      ],
    },
    // Machines other than classic (docs/design/machines.md, section 4.9).
    'machine.classic': {
      all: [
        ['Back to the classic claw! Line up over a plush and press grab.', 'happy'],
        ['The classic machine it is. Aim for the middle of a plush.', 'calm'],
        ['Good old claw time! Pick a plush that sits on top of the pile.', 'happy'],
      ],
      gtc: [
        ['Back at the classic {event} claw! Pick a plush and line up the grab.', 'happy'],
        ['The booth favourite, the classic claw. Aim for the tummy and press grab when ready.', 'cheer'],
      ],
    },
    'machine.bridge': {
      all: [
        ['Welcome to Tippy Bridge! Lift one end of the box and walk it between the bars.', 'happy'],
        ['Tippy Bridge is about patience. Nudge one end at a time until the box drops through.', 'think'],
        ['On the bridge, grab near one end of the box, not the middle.', 'think'],
      ],
      gtc: [
        ['Tippy Bridge, {event} edition! Work one end of the box at a time, like a careful lab experiment.', 'happy'],
        ['Booth challenge: tip the box off its bars, one patient end at a time.', 'think'],
      ],
    },
    'machine.shelf': {
      all: [
        ['Welcome to Tumble Shelf! Push the boxes over the front edge to score.', 'happy'],
        ['On Tumble Shelf the claw nudges boxes forward. Every box that tumbles in counts.', 'think'],
        ['Shelf time! Aim just behind a box near the edge and give it a push.', 'happy'],
      ],
      gtc: [
        ['Tumble Shelf at the {event} booth! Nudge boxes over the edge to collect points.', 'happy'],
        ['Think of it as shipping boxes off the show floor. Push them over the edge!', 'cheer'],
      ],
    },
    'machine.rush': {
      all: [
        ['Welcome to Sparkle Rush! Grab as many gems as you can before time runs out.', 'cheer'],
        ['Sparkle Rush is a race against the clock. Quick grabs, quick drops!', 'cheer'],
        ['The timer starts with your first move. Go for clusters of shiny gems.', 'think'],
      ],
      gtc: [
        ['Sparkle Rush, {event} speed run! Grab gems fast, like benchmarking a fresh build.', 'cheer'],
        ['Time to overclock! Grab as many gems as you can before the clock stops.', 'cheer'],
      ],
    },
    'bridge.progress': {
      all: [
        ['The box moved! Keep working the same end a little more.', 'cheer'],
        ['Nice, that try shifted the box toward the gap.', 'happy'],
        ['Progress! The box shifted a little. Stay patient with it.', 'think'],
      ],
      gtc: [
        ['Measurable progress, like a good benchmark run. The box shifted toward the gap!', 'cheer'],
        ['Nice iteration! That try moved the box. Keep refining at the {event} bridge.', 'happy'],
      ],
    },
    'bridge.same': {
      all: [
        ['The box barely moved that time. Try grabbing nearer the other end.', 'think'],
        ['Hmm, not much change. Aim at an end of the box, not its middle.', 'think'],
        ['That one did not shift it much. A different end might help.', 'calm'],
      ],
      gtc: [
        ['No big change this run. Like any good lab, try a different end of the box.', 'think'],
        ['Barely moved. Debug the approach: grab nearer one end of the box.', 'think'],
      ],
    },
    'bridge.stuck': {
      all: [
        ['The box looks stuck. Press Call staff and it gets set back up.', 'oops'],
        ['Wedged tight! Tap Call staff to put the box back on the bars.', 'oops'],
        ['That box is jammed. Calling staff resets it, with no penalty.', 'calm'],
      ],
      gtc: [
        ['Box jammed! Tap Call staff and the {event} crew will set it back up.', 'oops'],
        ['Stuck like a frozen demo. Press Call staff for a quick reset.', 'oops'],
      ],
    },
    'shelf.edge': {
      all: [
        ['Ooh, a box is right at the edge of the shelf! One more nudge?', 'think'],
        ['That box is teetering on the edge. Push gently from behind.', 'think'],
        ['A box is hanging over the edge! Aim just behind it next time.', 'think'],
      ],
      gtc: [
        ['A box is teetering on the shelf edge, like a demo ready to go live.', 'think'],
        ['Right at the edge! Give that box one more careful push.', 'cheer'],
      ],
    },
    'items.one': {
      all: [
        ['Plop! Right into the opening. Nice work!', 'happy'],
        ['It tumbled in! That counts toward your session.', 'happy'],
        ['Nice drop! Line up the next one while you are warmed up.', 'happy'],
      ],
      gtc: [
        ['Shipped! Straight off the {event} show floor and into the opening.', 'cheer'],
        ['Nice drop! Your session score just got a little boost.', 'happy'],
      ],
    },
    'items.many': {
      all: [
        ['Multi-drop! Several fell in at once. That was a great try!', 'cheer'],
        ['Wow, more than one in a single try! Great push.', 'cheer'],
        ['A whole bunch tumbled in! The session score loves that.', 'cheer'],
      ],
      gtc: [
        ['Parallel processing! Several dropped in at once. Great try!', 'cheer'],
        ['A batch job well done! More than one in a single try.', 'cheer'],
      ],
    },
    'time.low': {
      all: [
        ['Just a few seconds left! Quick grabs near the chute.', 'cheer'],
        ['Time is almost up! Go for the closest sparkles.', 'cheer'],
        ['The clock is running low! One more quick grab?', 'cheer'],
      ],
      gtc: [
        ['Final seconds of this run! Grab fast, like the last minutes before a keynote.', 'cheer'],
        ['The clock is nearly out! One more quick grab for your {event} score.', 'cheer'],
      ],
    },
    'session.over': {
      all: [
        ["That's the session! Thanks for playing. Want another round?", 'happy'],
        ['Session complete! Check your score and play again if you like.', 'happy'],
        ["And that's a wrap! Nice playing. Another session is one tap away.", 'happy'],
      ],
      gtc: [
        ["That's a wrap on this {event} session! Thanks for playing at our booth.", 'happy'],
        ['Session complete! Take a breather, or run it again before your next talk.', 'happy'],
      ],
    },
    'session.reward': {
      all: [
        ['You earned a prize this session! {toy} is yours, check the card.', 'cheer'],
        ['Great session! {toy} joins your collection.', 'cheer'],
        ['Prize time! Your session earned {toy}. Well played!', 'cheer'],
      ],
      gtc: [
        ['Great session! {toy} is your {event} booth prize.', 'cheer'],
        ['You earned {toy} this session! A perfect souvenir from the show floor.', 'cheer'],
      ],
    },
    'session.rank': {
      all: [
        ['A top-ten score! Enter your initials for the leaderboard.', 'cheer'],
        ['You made the leaderboard! Pick three letters to sign your score.', 'cheer'],
        ['High score! Your run earned a place on the leaderboard.', 'cheer'],
      ],
      gtc: [
        ['Leaderboard material! Sign your {event} run with three initials.', 'cheer'],
        ['A top-ten run! Benchmarks like that deserve your initials.', 'cheer'],
      ],
    },
    'hint.bridge': {
      all: [
        ['Grab near one end of the box, not the middle. Small lifts add up.', 'think'],
        ['Watch which end sits lower, then lift the high end so it slides toward the gap.', 'think'],
        ['Box wedged at an angle? Press Call staff and it goes back to the start.', 'calm'],
      ],
      gtc: [
        ['Treat the bridge like a hands-on lab: one end at a time, then check the result.', 'think'],
        ['Patience wins at the {event} booth. Nudge one end, then the other.', 'calm'],
      ],
    },
    'hint.shelf': {
      all: [
        ['Aim just behind a box near the front edge, then let the claw push it over.', 'think'],
        ['Boxes right at the edge fall with the lightest touch. Try those first.', 'think'],
        ['Tall stacks topple easily. Aim at the top box of a high stack.', 'think'],
      ],
      gtc: [
        ['Shelf strategy: pick the box closest to the edge, like choosing the fastest path.', 'think'],
        ['At the {event} booth every box over the edge counts. Go for the front row.', 'happy'],
      ],
    },
    'hint.rush': {
      all: [
        ['The clock starts with your first move. Aim at a tight cluster of gems.', 'think'],
        ['Big gems are worth more. Drop the claw where several sit close together.', 'think'],
        ['Quick grabs win the rush. No need to wait for the perfect spot.', 'cheer'],
      ],
      gtc: [
        ['Think in parallel: aim where many gems sit together and scoop them in one go.', 'think'],
        ['{event} speed-run tip: short moves, quick grabs, straight to the chute.', 'cheer'],
      ],
    },
  },
};
