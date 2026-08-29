const {
  conversation,
  composerSeat,
  composerCard,
  anyPhase,
  conversationScrolls,
} = require('./dom-adapter.js');

function createComposerSessionResolver(documentRef = document) {
  const resolve = () => {
    const currentConversation = conversation(documentRef);
    const currentSeat = composerSeat(currentConversation);
    const currentCard = composerCard(currentSeat);
    const currentSurface = anyPhase(currentConversation) || conversationScrolls(currentConversation)[0] || null;
    return { conversation: currentConversation, seat: currentSeat, card: currentCard, surface: currentSurface };
  };

  return { resolve };
}

module.exports = { createComposerSessionResolver };
