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
    },
    first_play: {
      all: [
        ['Use the arrows to line up the claw, then press the big grab button.', 'calm'],
        ['Left and right slide the claw. Up sends it back, down brings it closer.', 'calm'],
        ['First try! Park the claw right above a plush, then press grab.', 'happy'],
        ['Tip for round one: aim for the middle of the body, not the ears.', 'think'],
      ],
      sakura: [['First round in the sakura shop: line up above a plush and grab gently.', 'calm']],
      storybook: [['Chapter one: steer the claw over a friend and press grab to begin.', 'calm']],
      ocean: [['First dive! Float the claw above a sea friend, then press grab.', 'happy']],
      cosmic: [['First mission! Steer above your target, then press grab for touchdown.', 'happy']],
    },
    idle: {
      all: [
        ['Still choosing? Try a plush sitting on top, those are easier to lift.', 'think'],
        ['No rush! Move the claw around and see which plush looks easiest.', 'calm'],
        ['Psst, the ones near the front are simpler to line up.', 'think'],
        ["Want a hint? Look for a plush that isn't squeezed between the others.", 'think'],
        ["Take your time. Press an arrow whenever you're ready to aim.", 'calm'],
      ],
      sakura: [["The petals can wait. Pick a fluffy friend to chase whenever you're ready.", 'calm']],
      storybook: [['Every story needs a hero. Which friend will you rescue first?', 'think']],
      ocean: [['The tide is calm right now, a perfect moment to line up.', 'calm']],
      cosmic: [["The stars are drifting slowly. Lock onto a target whenever you're ready, captain.", 'calm']],
    },
    'idle.tracking': {
      all: [
        ['Want another angle? Lean a little left or right and peek inside.', 'think'],
        ['Try moving your head a bit. The view shifts so you can judge the depth.', 'think'],
        ['Lean sideways to see how far back the claw really is.', 'think'],
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
    },
    'empty.dir': {
      all: [
        ['Missed that one. Try moving the claw a bit more {dir} next time.', 'think'],
        ['Nothing there this time. The nearest plush was a little {dir}.', 'think'],
        ["Empty claw! Slide a little {dir} and you'll be right above {near}.", 'think'],
        ['Not quite lined up. Go a bit further {dir} before you drop.', 'think'],
        ['The claw landed in a gap. Aim slightly {dir} to cover a plush.', 'oops'],
      ],
    },
    'empty.none': {
      all: [
        ['Nothing under the claw that time. Line the ring up on a plush first.', 'think'],
        ['Empty grab! Check the target ring before you press the button.', 'oops'],
        ['The claw found only air. Aim right over a plush and try again?', 'oops'],
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
    },
    'slip.eccentric': {
      all: [
        ['It was only holding on by the edge. Grab closer to the middle of the body.', 'oops'],
        ['So close! The grip was off-centre. Aim right over the tummy next time.', 'oops'],
        ['It tipped out sideways. Centre the claw on the plush and try again?', 'think'],
      ],
    },
    'slip.weak_support': {
      all: [
        ['Only two fingers got under it. Try the widest part of the body.', 'think'],
        ['It needed one more finger underneath! Aim so the claw hugs it evenly.', 'oops'],
        ['The hold was a bit thin. Drop over the centre so every finger wraps around.', 'think'],
      ],
    },
    'slip.contact_lost': {
      all: [
        ['The fingers lost their hold on the way up. A centred grab stays put.', 'oops'],
        ['It wriggled free! Try catching it lower, around the body.', 'oops'],
        ['Almost had it, then the grip let go. Aim for the round middle next time.', 'think'],
      ],
    },
    'slip.transport_swing': {
      all: [
        ['It swung loose on the ride over. So close! A centred grab swings less.', 'oops'],
        ['Whoa, the swing shook it off! You did lift it though, nicely done.', 'oops'],
        ['It slipped during the trip to the chute. Almost there, want to try once more?', 'oops'],
      ],
    },
    'slip.overload': {
      all: [
        ['That one was heavy for the claw! Try a smaller plush or a more centred hug.', 'oops'],
        ['Too much to hold that time. Grab around the middle for a stronger grip.', 'think'],
        ["The claw couldn't carry it. A centred hold spreads the weight much better.", 'think'],
      ],
    },
    'slip.bounced_out': {
      all: [
        ['It bounced off the rim of the chute! So close, you carried it all the way.', 'oops'],
        ['Oh no, it hopped off the edge at the last second. That was a great carry!', 'oops'],
        ["It landed on the chute's rim and rolled back. Almost there, try once more?", 'oops'],
      ],
    },
    'slip.generic': {
      all: [
        ['You had it for a moment! Try a little closer to the middle.', 'oops'],
        ['So close, it slipped right out. Centre the claw and go again?', 'oops'],
        ['It got away this time, but that was a real grab. Nice work!', 'happy'],
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
    },
    'win.demo': {
      all: [
        ['That was just a demo catch. Tap start and try it yourself!', 'happy'],
        ["See how it's done? The demo doesn't count, so now it's your turn.", 'happy'],
        ['Demo win! Press start to catch one for your own collection.', 'happy'],
      ],
    },
    'miss.demo': {
      all: [
        ["Even the demo misses sometimes! Want to show it how it's done?", 'happy'],
        ['Demo round over. Tap start whenever you want to play for real.', 'calm'],
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
    },
    'retry.streak': {
      all: [
        ['Tricky pile today! Try a plush that sits on top with space around it.', 'think'],
        ["Let's switch targets. Pick one near the front that isn't squeezed in.", 'think'],
        ["You're getting closer each time. Aim for a round tummy, right in the middle.", 'think'],
        ['Tough streak! A fresh angle might help, or take a little break.', 'calm'],
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
    },
    'tip.tracking': {
      all: [
        ['Lean left or right to peek around. It helps you judge the depth.', 'think'],
        ['Move your head a little and watch the toys shift. Nearer ones move more.', 'think'],
      ],
    },
  },
};
