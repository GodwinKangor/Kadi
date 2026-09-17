# Introduction
Kadi is a Kenyan card game that can be played with 2-5 players using a standard 54-card deck. The game is fast-paced and simple to learn.

# Objective
The goal of Kadi is to be the first player to play all the winning cards in a single move.
Card Types

A standard 54-card deck is used, consisting of 4 suits (Hearts, Diamonds, Spades, Clubs) and 2 Jokers. Each suit has 13 cards, including Ace, 2 to 10, Jack, Queen, and King.

In Kadi, cards are specified as follows:
- Jack cards (J) are Jump Cards.
- Queen (Q) and 8 cards are Question Cards.
- King cards (K) are Kickback Cards.
- 4, 5, 6, 7, 9, 10, and Ace (A) cards are Answer Cards.
- 2, 3, and Jokers (JOK) are Penalty Cards.

# Dealing
The dealer shuffles the deck and deals 3 or 4 cards to each player (depending on the number of players in the game). The remaining cards form the draw pile, and the top card of the draw pile is placed face up to start the discard pile. 

The following cards cannot start the discard pile:
- 2 and 3 cards
- Question Cards
- Kickback Cards
- Jump Cards
- Joker Cards
- Ace Cards

If one of these cards is drawn, the dealer returns it to the draw pile, shuffles the deck, places the top card face up, and repeats the process until a valid card is drawn.

# Rules
- The previous winner or the dealer (if it's a new game) starts the game and determines direction of play.
- Players must play a card that matches the suit or rank of the top card on the discard pile.
- If a player plays a card that does not match the suit or rank of the top card on the discard pile, they are penalised by picking a card from the draw pile and game proceeds to next player.
- If a player cannot play a card, they must draw a card from the draw pile.
- Question Cards (8 and Q) follow the normal suit-or-rank matching rule: any 8 matches any other 8 and any Q matches any other Q regardless of suit, while an 8 played on a Q (or a Q on an 8) is only legal if the suits match.
- A Question Card must be answered in the same move as it is played, in one of two ways:
    - with another Question Card of the same suit, which itself then needs answering — so a player can chain through several same-suit Question Cards before closing the exchange, or
    - directly with an Answer Card of the same suit, which closes the exchange.
- Only the player who asked the question can answer it, in that same move. If they cannot close the exchange with a matching Answer Card (even after chaining through every same-suit Question Card they hold), none of the Question Cards are played — the asking player draws one card from the draw pile instead and their turn ends. Opponents are never penalised for someone else's unanswered question.
- Once a question exchange is resolved (or abandoned by drawing), play continues as normal from the next player, matching suit or rank against whatever card is now on top of the discard pile.
- If a player plays a Jump Card, the next player is skipped. However, the player who was to play next can counter the move by playing their individual Jump Card, and the rules for Jump Cards apply based on this move.
- If a player plays a Kickback Card, the game direction reverses. The player who was to play next can counter the move by playing their individual Kickback Card, and the rules for Kickback Cards apply based on the move made.
- A player may play several cards of the exact same rank together as a single move (for example three different 5s, or two 2s) — this applies to every rank except Question Cards, which instead chain by matching suit as described above. Their effects stack: multiple Jump Cards skip one extra player each, multiple Kickback Cards reverse direction once each (so an even number cancels out), and multiple Penalty Cards of the same rank add their values together same as "bomb for bomb". A bulk play of Answer Cards is also a legal way to go out and win, same as a single Answer Card.
- Aces are wild: an Ace can be played at any time, on any card, matching or not, penalty pending or not.
- A single Ace lets the player declare what the next play must match — either one specific suit, or a whole color ("all red" / "all black"). If they don't declare, it defaults to the Ace's own suit.
- The Ace of Spades is the special Ace: playing it — even by itself — locks in *both* a required suit (or color) and a required rank, not just a suit. Playing two or more regular Aces together (see the same-rank bulk play rule above) carries the exact same power, spades or not. The next player can only continue by playing an Ace (still wild), a card that satisfies both the locked suit and rank, or by drawing. A single countering Ace can only change the locked suit/color — the locked rank stays in force until either it's actually satisfied by a real card, or someone plays a fresh special Ace (of Spades, or 2+ together) to re-lock both. Since your opponents can see the suit/rank you locked but never know which cards are actually left in your hand, this is a strong bluffing tool, especially down to your last couple of cards.
- If a player realizes they can win on the next round of play, they must announce "Niko Kadi" — but only in the window right after the play that leaves their hand one move from winning, and only until the next player's turn concludes. Announcing before that play, or after the next player has already gone, doesn't count. Missing the window costs the player a one-card penalty draw, applied right before their own next turn.
- If the draw pile runs out of cards, the discard pile (excluding the top card) is shuffled to form the draw pile.
- Penalty Cards (2, 3, and Jokers) must be followed by the next player drawing 2, 3 or 5 cards, respectively. The next player can avoid the penalty by:
    - Playing any Penalty Card — a 2, a 3, or a Joker, not necessarily the same rank as the one just played ("bomb for bomb"). Their values stack, so a 2 followed by a 3 followed by a Joker leaves a 10-card penalty for whoever can't forward or cancel it.
    - Playing an Ace card, which cancels the entire accumulated penalty outright (the next player does not draw anything). The game continues with the suit from the previous Penalty Card.
    - Note that playing a Penalty Card only forwards the (growing) penalty to the next player.
- Jokers have a color (there's a red Joker and a black Joker in the deck), and if a penalty chain fizzles out with a Joker left on top of the discard pile, the next play just needs to match that Joker's own color (any red-suited card for the red Joker, any black-suited card for the black Joker) — the same "all red"/"all black" matching an Ace can declare.

# Illegal Plays

A play is illegal whenever it doesn't satisfy any of the legal-play conditions above for the card(s) being played. In practice:

- The card doesn't match the top of the discard pile by rank or by the currently required suit/color (including a Joker's own color, or a suit/color locked in by an Ace), and it isn't an Ace — Aces are always legal to play, at any time.
- A penalty is pending and the card played is neither a Penalty Card (2, 3, Joker — any rank counts, see "bomb for bomb") nor an Ace.
- A Question Card (8 or Q) is played but the player can't close the exchange with a matching Answer Card, even after chaining through every same-suit Question Card in their hand.
- A suit-and-rank has been locked by a special Ace (Ace of Spades, or two-or-more Aces together) or a prior double-lock persists through a counter-Ace, and the card played satisfies neither the locked suit/color nor the locked rank, and it isn't an Ace.
- It isn't the player's turn, or the card doesn't exist in their hand.

Consequences differ slightly by case:
- A straightforwardly illegal card (first bullet) or an unmatched pending penalty (second bullet): the card is **not played** — it's a one-card penalty draw for the player, and their turn ends.
- An unanswerable Question Card (third bullet): none of the Question Cards are played either — same one-card penalty draw, turn ends, and the cards stay in the player's hand to try again another turn.
- An unmatched suit/rank lock (fourth bullet): also not played — same one-card penalty draw and turn ends.

In every case, the attempted card(s) stay in the player's hand; only the single penalty card gets added.

# Winning
A player cannot win if any of the players is cardless.

For a player to win, they must play all their winning cards in one move and, have had said “Niko Kadi” in the previous round. 

The winning cards are:
-	Answer Cards — including several of the same rank played together (e.g. going out on three 5s at once).
-	Question Cards followed by their matching answer cards, including a chain of several same-suit Question Cards closed by a single Answer Card, all played in the same move.

