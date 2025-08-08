module.exports = (io) => {
  const handleCheckin = (socket, data) => {
    const { venueId } = data;
    socket.join(`venue_${venueId}`);
    io.to(`venue_${venueId}`).emit("checkinUpdate", data);
  };

  const handlePromotion = (socket, data) => {
    const { venueId } = data;
    io.to(`venue_${venueId}`).emit("newPromotion", data);
  };

  return {
    handleCheckin,
    handlePromotion,
  };
};
