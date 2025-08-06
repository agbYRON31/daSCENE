import React, { useState, useEffect } from "react";
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Image,
  Modal,
  TextInput,
  ActivityIndicator,
  Alert,
  FlatList,
  StatusBar,
  Dimensions,
  SafeAreaView,
} from "react-native";
import {
  Ionicons,
  MaterialIcons,
  FontAwesome,
  Feather,
  MaterialCommunityIcons,
} from "@expo/vector-icons";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { NavigationContainer } from "@react-navigation/native";
import { LineChart, BarChart } from "react-native-chart-kit";
import axios from "axios";
import io from "socket.io-client";
import * as SecureStore from "expo-secure-store";

// Socket.io connection
const socket = io("http://your-server-ip:3001", {
  transports: ["websocket"],
  autoConnect: false,
});

// Tab Navigator
const Tab = createBottomTabNavigator();
const { width: screenWidth, height: screenHeight } = Dimensions.get("window");

// API configuration
const API_BASE_URL = "http://your-server-ip:3001/api";

const SceneAppComplete = () => {
  const [appMode, setAppMode] = useState("consumer"); // 'consumer' or 'promoter'
  const [viewMode, setViewMode] = useState("customer"); // 'customer' or 'venue'
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Consumer app state
  const [activeTab, setActiveTab] = useState("map");
  const [venues, setVenues] = useState([]);
  const [events, setEvents] = useState([]);
  const [userCheckedIn, setUserCheckedIn] = useState(null);
  const [selectedVenue, setSelectedVenue] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [myRSVPs, setMyRSVPs] = useState([]);
  const [showRSVPModal, setShowRSVPModal] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [selectedTicketType, setSelectedTicketType] = useState(null);
  const [guestCount, setGuestCount] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");

  // Venue dashboard state
  const [promoterActiveTab, setPromoterActiveTab] = useState("dashboard");
  const [venueData, setVenueData] = useState(null);
  const [analyticsData, setAnalyticsData] = useState(null);
  const [promotions, setPromotions] = useState([]);
  const [newPromoModal, setNewPromoModal] = useState(false);
  const [newPromoData, setNewPromoData] = useState({
    title: "",
    description: "",
    startTime: "",
    endTime: "",
    type: "discount",
    discountPercentage: 10,
    validDays: [],
  });

  // Initialize socket when user logs in
  useEffect(() => {
    if (token) {
      socket.auth = { token };
      socket.connect();

      socket.on("newCheckin", (data) => {
        Alert.alert("New Check-in", `${data.userName} checked in!`);
        fetchVenues(); // Refresh venues data
      });

      socket.on("promotionUpdated", (data) => {
        Alert.alert("Promotion Updated", `${data.title} has been updated`);
        fetchPromotions();
      });

      socket.on("venueUpdated", () => {
        fetchVenues();
      });
    }

    return () => {
      socket.disconnect();
    };
  }, [token]);

  // Check for existing token on app load
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const storedToken = await SecureStore.getItemAsync("authToken");
        if (storedToken) {
          setToken(storedToken);
          fetchUserProfile(storedToken);
        }
      } catch (error) {
        console.error("Failed to load token", error);
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, []);

  // Fetch all data when token changes
  useEffect(() => {
    if (token) {
      fetchVenues();
      fetchEvents();
      fetchPhotos();
      if (appMode === "consumer") {
        fetchMyRSVPs();
      } else {
        fetchVenueData();
      }
    }
  }, [token, appMode]);

  // Fetch user profile
  const fetchUserProfile = async (token) => {
    try {
      setLoading(true);
      const response = await axios.get(`${API_BASE_URL}/profile`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setUser(response.data);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to fetch profile");
    } finally {
      setLoading(false);
    }
  };

  // Fetch venues
  const fetchVenues = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${API_BASE_URL}/venues`);
      setVenues(response.data.data);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to fetch venues");
    } finally {
      setLoading(false);
    }
  };

  // Fetch events
  const fetchEvents = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${API_BASE_URL}/events`);
      setEvents(response.data);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to fetch events");
    } finally {
      setLoading(false);
    }
  };

  // Fetch photos
  const fetchPhotos = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${API_BASE_URL}/photos`);
      setPhotos(response.data);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to fetch photos");
    } finally {
      setLoading(false);
    }
  };

  // Fetch my RSVPs
  const fetchMyRSVPs = async () => {
    try {
      setLoading(true);
      const response = await axios.get(
        `${API_BASE_URL}/users/${user?.id}/rsvps`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      setMyRSVPs(response.data);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to fetch RSVPs");
    } finally {
      setLoading(false);
    }
  };

  // Fetch venue data for promoter
  const fetchVenueData = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${API_BASE_URL}/venues/manager`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setVenueData(response.data);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to fetch venue data");
    } finally {
      setLoading(false);
    }
  };

  // Fetch analytics data
  const fetchAnalyticsData = async () => {
    try {
      setLoading(true);
      const response = await axios.get(
        `${API_BASE_URL}/venues/${venueData?.id}/analytics`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setAnalyticsData(response.data);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to fetch analytics");
    } finally {
      setLoading(false);
    }
  };

  // Fetch promotions
  const fetchPromotions = async () => {
    try {
      setLoading(true);
      const response = await axios.get(
        `${API_BASE_URL}/venues/${venueData?.id}/promotions`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setPromotions(response.data);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to fetch promotions");
    } finally {
      setLoading(false);
    }
  };

  // Handle login
  const handleLogin = async (email, password) => {
    try {
      setLoading(true);
      const response = await axios.post(`${API_BASE_URL}/auth/login`, {
        email,
        password,
      });

      // Store token securely
      await SecureStore.setItemAsync("authToken", response.data.token);

      setToken(response.data.token);
      setUser(response.data.user);
    } catch (err) {
      setError(err.response?.data?.error || "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  // Handle registration
  const handleRegister = async (email, password, name, role = "customer") => {
    try {
      setLoading(true);
      const response = await axios.post(`${API_BASE_URL}/auth/register`, {
        email,
        password,
        name,
        role,
      });

      // Store token securely
      await SecureStore.setItemAsync("authToken", response.data.token);

      setToken(response.data.token);
      setUser(response.data.user);
    } catch (err) {
      setError(err.response?.data?.error || "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  // Handle check-in
  const handleCheckIn = async (venueId, latitude, longitude) => {
    try {
      setLoading(true);
      const response = await axios.post(
        `${API_BASE_URL}/checkins`,
        { venueId, latitude, longitude },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      setUserCheckedIn(venueId);
      fetchVenues(); // Refresh venues data
      socket.emit("checkin", {
        venueId,
        userName: user.name,
      });
    } catch (err) {
      setError(err.response?.data?.error || "Failed to check in");
    } finally {
      setLoading(false);
    }
  };

  // Handle check-out
  const handleCheckOut = async (checkinId) => {
    try {
      setLoading(true);
      await axios.post(
        `${API_BASE_URL}/checkins/${checkinId}/checkout`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );

      setUserCheckedIn(null);
      fetchVenues(); // Refresh venues data
    } catch (err) {
      setError(err.response?.data?.error || "Failed to check out");
    } finally {
      setLoading(false);
    }
  };

  // Handle RSVP
  const handleRSVP = async () => {
    if (!selectedEvent || !selectedTicketType || !token) return;

    setLoading(true);
    try {
      const response = await axios.post(
        `${API_BASE_URL}/rsvps`,
        {
          eventId: selectedEvent.id,
          ticketType: selectedTicketType.name,
          guestCount,
          userId: user.id,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      setMyRSVPs([...myRSVPs, response.data]);
      setShowRSVPModal(false);
      Alert.alert("Success", "RSVP confirmed!");
    } catch (err) {
      setError(err.response?.data?.error || "Failed to RSVP");
    } finally {
      setLoading(false);
    }
  };

  // Create new promotion
  const createPromotion = async () => {
    try {
      setLoading(true);
      await axios.post(
        `${API_BASE_URL}/promotions`,
        { ...newPromoData, venueId: venueData?.id },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setNewPromoModal(false);
      fetchPromotions();
      socket.emit("promotionCreated", {
        venueId: venueData?.id,
        title: newPromoData.title,
      });
    } catch (err) {
      setError(err.response?.data?.error || "Failed to create promotion");
    } finally {
      setLoading(false);
    }
  };

  // Toggle promotion status
  const togglePromotion = async (promoId, currentStatus) => {
    try {
      setLoading(true);
      await axios.put(
        `${API_BASE_URL}/promotions/${promoId}`,
        { active: !currentStatus },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      fetchPromotions();
      socket.emit("promotionUpdated", {
        promotionId: promoId,
        active: !currentStatus,
      });
    } catch (err) {
      setError(err.response?.data?.error || "Failed to update promotion");
    } finally {
      setLoading(false);
    }
  };

  // Login Screen
  const AuthScreen = ({ onLogin }) => {
    const [isLogin, setIsLogin] = useState(true);
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [name, setName] = useState("");

    const handleAuth = async () => {
      if (isLogin) {
        await handleLogin(email, password);
      } else {
        await handleRegister(email, password, name);
      }
      if (onLogin) onLogin();
    };

    return (
      <View style={styles.authContainer}>
        <StatusBar barStyle="light-content" />
        <View style={styles.authHeader}>
          <Text style={styles.authTitle}>Scene</Text>
          <Text style={styles.authSubtitle}>
            {isLogin ? "Login" : "Register"}
          </Text>
        </View>

        {error ? <Text style={styles.authError}>{error}</Text> : null}

        <TextInput
          style={styles.authInput}
          placeholder="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          placeholderTextColor="#9ca3af"
        />

        <TextInput
          style={styles.authInput}
          placeholder="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholderTextColor="#9ca3af"
        />

        {!isLogin && (
          <TextInput
            style={styles.authInput}
            placeholder="Name"
            value={name}
            onChangeText={setName}
            placeholderTextColor="#9ca3af"
          />
        )}

        <TouchableOpacity
          style={styles.authButton}
          onPress={handleAuth}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text style={styles.authButtonText}>
              {isLogin ? "Login" : "Register"}
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.authToggle}
          onPress={() => setIsLogin(!isLogin)}
        >
          <Text style={styles.authToggleText}>
            {isLogin
              ? "Don't have an account? Register"
              : "Already have an account? Login"}
          </Text>
        </TouchableOpacity>
      </View>
    );
  };

  // Map component with real data
  const SceneMap = () => (
    <View style={styles.mapContainer}>
      {loading ? (
        <ActivityIndicator size="large" color="#ef4444" />
      ) : (
        <>
          <View style={styles.mapBackground}>
            {venues.map((venue, index) => (
              <TouchableOpacity
                key={venue.id}
                style={[
                  styles.mapPin,
                  {
                    left: `${20 + index * 25}%`,
                    top: `${30 + index * 20}%`,
                  },
                ]}
                onPress={() => setSelectedVenue(venue)}
              >
                <View
                  style={[
                    styles.pinCircle,
                    {
                      backgroundColor:
                        venue.sceneScore > 9
                          ? "#ef4444"
                          : venue.sceneScore > 8
                          ? "#dc2626"
                          : "#b91c1c",
                    },
                  ]}
                >
                  <MaterialIcons name="people" size={24} color="white" />
                </View>
                <View style={styles.pinBadge}>
                  <Text style={styles.pinBadgeText}>
                    {venue.currentCheckins}
                  </Text>
                </View>
                <View style={styles.scoreDisplay}>
                  <Text style={styles.scoreText}>{venue.sceneScore}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>

          <Modal
            visible={selectedVenue !== null}
            transparent={true}
            animationType="slide"
          >
            <View style={styles.modalOverlay}>
              <View style={styles.venueModal}>
                <View style={styles.modalHeader}>
                  <View>
                    <Text style={styles.venueTitle}>{selectedVenue?.name}</Text>
                    <Text style={styles.venueSubtitle}>
                      {selectedVenue?.location} • {selectedVenue?.distance}
                    </Text>
                  </View>
                  <TouchableOpacity onPress={() => setSelectedVenue(null)}>
                    <MaterialIcons name="close" size={24} color="#ef4444" />
                  </TouchableOpacity>
                </View>

                <View style={styles.venueStats}>
                  <View style={styles.statItem}>
                    <MaterialIcons name="star" size={20} color="#ef4444" />
                    <Text style={styles.statText}>
                      {selectedVenue?.sceneScore}
                    </Text>
                  </View>
                  <View style={styles.statItem}>
                    <MaterialIcons name="people" size={20} color="#ef4444" />
                    <Text style={styles.statText}>
                      {selectedVenue?.currentCheckins} here now
                    </Text>
                  </View>
                  <View style={styles.statItem}>
                    <MaterialIcons
                      name="camera-alt"
                      size={20}
                      color="#ef4444"
                    />
                    <Text style={styles.statText}>
                      {selectedVenue?.totalPhotos} photos
                    </Text>
                  </View>
                </View>

                {selectedVenue?.activePromotions?.length > 0 && (
                  <View style={styles.promoCard}>
                    <MaterialIcons
                      name="card-giftcard"
                      size={20}
                      color="#ef4444"
                    />
                    <Text style={styles.promoText}>
                      Active Promo: {selectedVenue.activePromotions[0].title}
                    </Text>
                  </View>
                )}

                <View style={styles.modalActions}>
                  <TouchableOpacity
                    style={[
                      styles.checkInButton,
                      userCheckedIn === selectedVenue?.id &&
                        styles.checkedInButton,
                    ]}
                    onPress={() =>
                      userCheckedIn === selectedVenue?.id
                        ? handleCheckOut(userCheckedIn)
                        : handleCheckIn(
                            selectedVenue?.id,
                            selectedVenue?.coordinates.lat,
                            selectedVenue?.coordinates.lng
                          )
                    }
                  >
                    <Text style={styles.checkInText}>
                      {userCheckedIn === selectedVenue?.id
                        ? "Checked In"
                        : "Check In"}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.cameraButton}>
                    <MaterialIcons
                      name="camera-alt"
                      size={20}
                      color="#ef4444"
                    />
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>
        </>
      )}
    </View>
  );

  // Venue list component with real data
  const VenueList = () => (
    <ScrollView style={styles.venueList}>
      <View style={styles.listHeader}>
        <Text style={styles.listTitle}>Venues Near You</Text>
        <View style={styles.searchContainer}>
          <MaterialIcons
            name="search"
            size={20}
            color="#ef4444"
            style={styles.searchIcon}
          />
          <TextInput
            style={styles.searchInput}
            placeholder="Search venues..."
            placeholderTextColor="#9ca3af"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#ef4444" />
      ) : (
        <View style={styles.venueCards}>
          {venues.map((venue) => (
            <View key={venue.id} style={styles.venueCard}>
              <View style={styles.cardHeader}>
                <View>
                  <Text style={styles.venueName}>{venue.name}</Text>
                  <Text style={styles.venueType}>
                    {venue.type} • {venue.location}
                  </Text>
                </View>
                <View style={styles.cardRight}>
                  <View style={styles.scoreContainer}>
                    <MaterialIcons name="star" size={16} color="#ef4444" />
                    <Text style={styles.scoreValue}>{venue.sceneScore}</Text>
                  </View>
                  <Text style={styles.distance}>{venue.distance}</Text>
                </View>
              </View>

              <View style={styles.cardStats}>
                <View style={styles.cardStatsLeft}>
                  <View style={styles.statPair}>
                    <MaterialIcons name="people" size={16} color="#ef4444" />
                    <Text style={styles.statSmall}>
                      {venue.currentCheckins}
                    </Text>
                  </View>
                  <View style={styles.statPair}>
                    <MaterialIcons
                      name="camera-alt"
                      size={16}
                      color="#ef4444"
                    />
                    <Text style={styles.statSmall}>{venue.totalPhotos}</Text>
                  </View>
                </View>
                {venue.hasPromo && (
                  <View style={styles.promoIndicator}>
                    <MaterialIcons
                      name="card-giftcard"
                      size={16}
                      color="#ef4444"
                    />
                    <Text style={styles.promoLabel}>Promo</Text>
                  </View>
                )}
              </View>

              <TouchableOpacity
                style={[
                  styles.venueCheckInButton,
                  userCheckedIn === venue.id && styles.venueCheckedInButton,
                ]}
                onPress={() =>
                  userCheckedIn === venue.id
                    ? handleCheckOut(userCheckedIn)
                    : handleCheckIn(
                        venue.id,
                        venue.coordinates.lat,
                        venue.coordinates.lng
                      )
                }
              >
                <Text style={styles.venueCheckInText}>
                  {userCheckedIn === venue.id ? "Checked In" : "Check In"}
                </Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );

  // Events List component
  const EventsList = () => {
    const filteredEvents = events.filter(
      (event) =>
        event.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        venues
          .find((v) => v.id === event.venueId)
          ?.name.toLowerCase()
          .includes(searchQuery.toLowerCase())
    );

    const renderEventItem = ({ item }) => {
      const venue = venues.find((v) => v.id === item.venueId);

      return (
        <TouchableOpacity
          style={styles.eventCard}
          onPress={() => {
            setSelectedEvent(item);
            setSelectedTicketType(null);
            setShowRSVPModal(true);
          }}
        >
          <View style={styles.eventImageContainer}>
            <Image
              source={{
                uri: item.imageUrl || "https://via.placeholder.com/300",
              }}
              style={styles.eventImage}
            />
            <View style={styles.eventDateBadge}>
              <Text style={styles.eventDateText}>
                {new Date(item.date).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}
              </Text>
            </View>
          </View>

          <View style={styles.eventDetails}>
            <Text style={styles.eventTitle}>{item.title}</Text>
            <View style={styles.eventMeta}>
              <Ionicons name="location-outline" size={16} color="#9ca3af" />
              <Text style={styles.eventLocation}>{venue?.name}</Text>
            </View>
            <View style={styles.eventMeta}>
              <Ionicons name="time-outline" size={16} color="#9ca3af" />
              <Text style={styles.eventTime}>
                {new Date(item.date).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </Text>
            </View>
            <Text style={styles.eventDescription} numberOfLines={2}>
              {item.description}
            </Text>

            <View style={styles.ticketPreview}>
              {item.ticketTypes.slice(0, 3).map((ticket) => (
                <View key={ticket.name} style={styles.ticketType}>
                  <Text style={styles.ticketPrice}>
                    {ticket.price === 0 ? "FREE" : `$${ticket.price}`}
                  </Text>
                  <Text style={styles.ticketName}>{ticket.name}</Text>
                </View>
              ))}
            </View>
          </View>
        </TouchableOpacity>
      );
    };

    return (
      <View style={styles.container}>
        <View style={styles.searchContainer}>
          <Ionicons
            name="search"
            size={20}
            color="#9ca3af"
            style={styles.searchIcon}
          />
          <TextInput
            style={styles.searchInput}
            placeholder="Search events or venues..."
            placeholderTextColor="#9ca3af"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>

        <FlatList
          data={filteredEvents}
          renderItem={renderEventItem}
          keyExtractor={(item) => item.id.toString()}
          contentContainerStyle={styles.listContent}
        />
      </View>
    );
  };

  // My RSVPs Screen
  const MyRSVPScreen = () => {
    if (myRSVPs.length === 0) {
      return (
        <View style={styles.emptyState}>
          <MaterialIcons name="event-available" size={48} color="#6b7280" />
          <Text style={styles.emptyStateText}>No RSVPs yet</Text>
          <Text style={styles.emptyStateSubtext}>
            Browse events to get started!
          </Text>
          <TouchableOpacity
            style={styles.browseButton}
            onPress={() => setActiveTab("events")}
          >
            <Text style={styles.browseButtonText}>Browse Events</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <FlatList
        data={myRSVPs}
        renderItem={({ item }) => {
          const event = events.find((e) => e.id === item.eventId);
          const venue = venues.find((v) => v.id === event?.venueId);

          return (
            <View style={styles.rsvpCard}>
              <View style={styles.rsvpHeader}>
                <Text style={styles.rsvpEventTitle}>{event?.title}</Text>
                <View style={styles.rsvpStatusBadge}>
                  <Text style={styles.rsvpStatusText}>CONFIRMED</Text>
                </View>
              </View>

              <View style={styles.rsvpDetails}>
                <View style={styles.rsvpDetailRow}>
                  <Ionicons name="location-outline" size={16} color="#9ca3af" />
                  <Text style={styles.rsvpDetailText}>{venue?.name}</Text>
                </View>
                <View style={styles.rsvpDetailRow}>
                  <Ionicons name="time-outline" size={16} color="#9ca3af" />
                  <Text style={styles.rsvpDetailText}>
                    {new Date(event?.date).toLocaleDateString()} at{" "}
                    {new Date(event?.date).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </Text>
                </View>
              </View>

              <View style={styles.rsvpFooter}>
                <Text style={styles.rsvpTicketType}>{item.ticketType}</Text>
                <Text style={styles.rsvpGuestCount}>
                  {item.guestCount} {item.guestCount === 1 ? "guest" : "guests"}
                </Text>
              </View>

              <View style={styles.rsvpActions}>
                <TouchableOpacity
                  style={styles.rsvpActionButton}
                  onPress={() => handleCheckIn(item.id)}
                >
                  <MaterialIcons name="qr-code" size={20} color="#3b82f6" />
                  <Text style={styles.rsvpActionText}>Check In</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.rsvpActionButton}>
                  <Feather name="share-2" size={20} color="#9ca3af" />
                </TouchableOpacity>
              </View>
            </View>
          );
        }}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={styles.rsvpListContent}
      />
    );
  };

  // Photo feed with real data
  const PhotoFeed = () => (
    <ScrollView style={styles.photoFeed}>
      <View style={styles.photoHeader}>
        <Text style={styles.photoTitle}>Scene Photos</Text>
        <TouchableOpacity style={styles.addPhotoButton}>
          <MaterialIcons name="add" size={20} color="white" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#ef4444" />
      ) : (
        <View style={styles.photoGrid}>
          {photos.map((photo) => (
            <TouchableOpacity key={photo.id} style={styles.photoCard}>
              <View style={styles.photoPlaceholder}>
                <MaterialIcons name="camera-alt" size={32} color="#ef4444" />
              </View>
              <View style={styles.photoOverlay}>
                <View style={styles.photoInfo}>
                  <View style={styles.photoLocation}>
                    <Ionicons name="location-on" size={16} color="#ef4444" />
                    <Text style={styles.photoLocationText}>
                      {photo.venue?.name || "Unknown venue"}
                    </Text>
                  </View>
                  <View style={styles.photoLikes}>
                    <MaterialIcons name="favorite" size={16} color="#ef4444" />
                    <Text style={styles.photoLikesText}>{photo.likes}</Text>
                  </View>
                </View>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </ScrollView>
  );

  // Profile with real data
  const Profile = ({ onLogout }) => (
    <ScrollView style={styles.profile}>
      {loading ? (
        <ActivityIndicator size="large" color="#ef4444" />
      ) : (
        <>
          <View style={styles.profileHeader}>
            <View style={styles.profileAvatar}>
              <Ionicons name="person" size={40} color="white" />
            </View>
            <Text style={styles.profileName}>
              {user?.name || "Your Profile"}
            </Text>
            <Text style={styles.profileRole}>
              {user?.role === "venue_manager"
                ? "Venue Manager"
                : "Scene Explorer"}
            </Text>
          </View>

          <View style={styles.profileStats}>
            <View style={styles.profileStat}>
              <Text style={styles.profileStatLabel}>Total Check-ins</Text>
              <Text style={styles.profileStatValue}>
                {user?.profile?.totalCheckins || 0}
              </Text>
            </View>
            <View style={styles.profileStat}>
              <Text style={styles.profileStatLabel}>Photos Shared</Text>
              <Text style={styles.profileStatValue}>
                {user?.profile?.photosShared || 0}
              </Text>
            </View>
            <View style={styles.profileStat}>
              <Text style={styles.profileStatLabel}>Scene Score</Text>
              <Text style={styles.profileStatValue}>
                {user?.profile?.sceneScore || 0}
              </Text>
            </View>
          </View>

          <TouchableOpacity style={styles.editProfileButton}>
            <Text style={styles.editProfileText}>Edit Profile</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.logoutButton} onPress={onLogout}>
            <Text style={styles.logoutButtonText}>Sign Out</Text>
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  );

  // Analytics Tab for promoter dashboard
  const AnalyticsTab = () => (
    <ScrollView style={styles.dashboardContent}>
      <Text style={styles.dashboardTitle}>Venue Analytics</Text>

      {loading ? (
        <ActivityIndicator size="large" color="#ef4444" />
      ) : (
        <>
          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>
                {venueData?.currentCheckins || 0}
              </Text>
              <Text style={styles.statLabel}>Current Check-ins</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>
                {venueData?.totalCheckins || 0}
              </Text>
              <Text style={styles.statLabel}>Total Check-ins</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{venueData?.sceneScore || 0}</Text>
              <Text style={styles.statLabel}>Scene Score</Text>
            </View>
          </View>

          <Text style={styles.chartTitle}>Weekly Check-ins</Text>
          <LineChart
            data={{
              labels:
                analyticsData?.weeklyCheckins.map((item) =>
                  item.day.substring(0, 3)
                ) || [],
              datasets: [
                {
                  data:
                    analyticsData?.weeklyCheckins.map(
                      (item) => item.checkins
                    ) || [],
                },
              ],
            }}
            width={screenWidth - 40}
            height={220}
            chartConfig={{
              backgroundColor: "#1e1e1e",
              backgroundGradientFrom: "#1e1e1e",
              backgroundGradientTo: "#1e1e1e",
              decimalPlaces: 0,
              color: (opacity = 1) => `rgba(239, 68, 68, ${opacity})`,
              labelColor: (opacity = 1) => `rgba(255, 255, 255, ${opacity})`,
              style: { borderRadius: 16 },
            }}
            bezier
            style={styles.chart}
          />

          <Text style={styles.chartTitle}>Hourly Traffic</Text>
          <BarChart
            data={{
              labels:
                analyticsData?.hourlyTraffic.map((item) => item.hour) || [],
              datasets: [
                {
                  data:
                    analyticsData?.hourlyTraffic.map((item) => item.users) ||
                    [],
                },
              ],
            }}
            width={screenWidth - 40}
            height={220}
            chartConfig={{
              backgroundColor: "#1e1e1e",
              backgroundGradientFrom: "#1e1e1e",
              backgroundGradientTo: "#1e1e1e",
              decimalPlaces: 0,
              color: (opacity = 1) => `rgba(239, 68, 68, ${opacity})`,
              labelColor: (opacity = 1) => `rgba(255, 255, 255, ${opacity})`,
            }}
            style={styles.chart}
          />
        </>
      )}
    </ScrollView>
  );

  // Promotions Tab for promoter dashboard
  const PromotionsTab = () => (
    <ScrollView style={styles.dashboardContent}>
      <View style={styles.promoHeader}>
        <Text style={styles.dashboardTitle}>Promotions</Text>
        <TouchableOpacity
          style={styles.addButton}
          onPress={() => setNewPromoModal(true)}
        >
          <MaterialIcons name="add" size={20} color="white" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#ef4444" />
      ) : (
        <>
          {promotions.map((promo) => (
            <View key={promo.id} style={styles.promoCard}>
              <View style={styles.promoCardHeader}>
                <Text style={styles.promoTitle}>{promo.title}</Text>
                <TouchableOpacity
                  style={[
                    styles.toggleButton,
                    promo.active && styles.toggleButtonActive,
                  ]}
                  onPress={() => togglePromotion(promo.id, promo.active)}
                >
                  <Text style={styles.toggleButtonText}>
                    {promo.active ? "Active" : "Inactive"}
                  </Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.promoDescription}>{promo.description}</Text>
              <View style={styles.promoDetails}>
                <Text style={styles.promoDetail}>
                  {promo.startTime} - {promo.endTime}
                </Text>
                <Text style={styles.promoDetail}>
                  {promo.type === "discount"
                    ? `${promo.discountPercentage}% off`
                    : "Free offer"}
                </Text>
                <Text style={styles.promoDetail}>
                  {promo.validDays.join(", ")}
                </Text>
              </View>
              <Text style={styles.promoRedemptions}>
                {promo.redemptions} redemptions
              </Text>
            </View>
          ))}
        </>
      )}

      {/* New Promotion Modal */}
      <Modal visible={newPromoModal} transparent={true} animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.promoModal}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Create New Promotion</Text>
              <TouchableOpacity onPress={() => setNewPromoModal(false)}>
                <MaterialIcons name="close" size={24} color="#ef4444" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalContent}>
              <TextInput
                style={styles.input}
                placeholder="Title"
                value={newPromoData.title}
                onChangeText={(text) =>
                  setNewPromoData({ ...newPromoData, title: text })
                }
                placeholderTextColor="#9ca3af"
              />
              <TextInput
                style={styles.input}
                placeholder="Description"
                value={newPromoData.description}
                onChangeText={(text) =>
                  setNewPromoData({ ...newPromoData, description: text })
                }
                placeholderTextColor="#9ca3af"
              />

              <View style={styles.timeInputs}>
                <TextInput
                  style={[styles.input, styles.timeInput]}
                  placeholder="Start Time (HH:MM)"
                  value={newPromoData.startTime}
                  onChangeText={(text) =>
                    setNewPromoData({ ...newPromoData, startTime: text })
                  }
                  placeholderTextColor="#9ca3af"
                />
                <TextInput
                  style={[styles.input, styles.timeInput]}
                  placeholder="End Time (HH:MM)"
                  value={newPromoData.endTime}
                  onChangeText={(text) =>
                    setNewPromoData({ ...newPromoData, endTime: text })
                  }
                  placeholderTextColor="#9ca3af"
                />
              </View>

              <View style={styles.promoTypeContainer}>
                <Text style={styles.label}>Promotion Type:</Text>
                <View style={styles.radioGroup}>
                  <TouchableOpacity
                    style={styles.radioButton}
                    onPress={() =>
                      setNewPromoData({ ...newPromoData, type: "discount" })
                    }
                  >
                    <View style={styles.radioCircle}>
                      {newPromoData.type === "discount" && (
                        <View style={styles.radioDot} />
                      )}
                    </View>
                    <Text style={styles.radioLabel}>Discount</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.radioButton}
                    onPress={() =>
                      setNewPromoData({ ...newPromoData, type: "free" })
                    }
                  >
                    <View style={styles.radioCircle}>
                      {newPromoData.type === "free" && (
                        <View style={styles.radioDot} />
                      )}
                    </View>
                    <Text style={styles.radioLabel}>Free Offer</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {newPromoData.type === "discount" && (
                <View style={styles.discountInput}>
                  <Text style={styles.label}>Discount Percentage:</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="10"
                    keyboardType="numeric"
                    value={String(newPromoData.discountPercentage)}
                    onChangeText={(text) =>
                      setNewPromoData({
                        ...newPromoData,
                        discountPercentage: parseInt(text) || 0,
                      })
                    }
                    placeholderTextColor="#9ca3af"
                  />
                </View>
              )}

              <View style={styles.daysContainer}>
                <Text style={styles.label}>Valid Days:</Text>
                <View style={styles.daysGrid}>
                  {[
                    "Monday",
                    "Tuesday",
                    "Wednesday",
                    "Thursday",
                    "Friday",
                    "Saturday",
                    "Sunday",
                  ].map((day) => (
                    <TouchableOpacity
                      key={day}
                      style={[
                        styles.dayButton,
                        newPromoData.validDays.includes(day.toLowerCase()) &&
                          styles.dayButtonSelected,
                      ]}
                      onPress={() => {
                        const dayLower = day.toLowerCase();
                        if (newPromoData.validDays.includes(dayLower)) {
                          setNewPromoData({
                            ...newPromoData,
                            validDays: newPromoData.validDays.filter(
                              (d) => d !== dayLower
                            ),
                          });
                        } else {
                          setNewPromoData({
                            ...newPromoData,
                            validDays: [...newPromoData.validDays, dayLower],
                          });
                        }
                      }}
                    >
                      <Text style={styles.dayButtonText}>
                        {day.substring(0, 3)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </ScrollView>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => setNewPromoModal(false)}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.createButton}
                onPress={createPromotion}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text style={styles.createButtonText}>Create Promotion</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );

  // Consumer App Tabs
  const ConsumerApp = () => (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          let iconName;

          if (route.name === "Map") {
            iconName = focused ? "map" : "map-outline";
          } else if (route.name === "Venues") {
            iconName = focused ? "location" : "location-outline";
          } else if (route.name === "Events") {
            iconName = focused ? "calendar" : "calendar-outline";
          } else if (route.name === "My RSVPs") {
            iconName = focused ? "list" : "list-outline";
          } else if (route.name === "Profile") {
            iconName = focused ? "person" : "person-outline";
          }

          return <Ionicons name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: "#ef4444",
        tabBarInactiveTintColor: "#9ca3af",
        tabBarStyle: {
          backgroundColor: "#111827",
          borderTopColor: "#1f2937",
        },
        headerShown: false,
      })}
    >
      <Tab.Screen name="Map" component={SceneMap} />
      <Tab.Screen name="Venues" component={VenueList} />
      <Tab.Screen name="Events" component={EventsList} />
      <Tab.Screen name="My RSVPs" component={MyRSVPScreen} />
      <Tab.Screen name="Profile">
        {() => (
          <Profile
            onLogout={() => {
              SecureStore.deleteItemAsync("authToken");
              setToken(null);
              setUser(null);
            }}
          />
        )}
      </Tab.Screen>
    </Tab.Navigator>
  );

  // Promoter App Tabs
  const PromoterApp = () => (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          let iconName;

          if (route.name === "Dashboard") {
            iconName = focused ? "bar-chart" : "bar-chart-outline";
          } else if (route.name === "Analytics") {
            iconName = focused ? "analytics" : "analytics-outline";
          } else if (route.name === "Promotions") {
            iconName = focused ? "local-offer" : "local-offer-outline";
          } else if (route.name === "Profile") {
            iconName = focused ? "person" : "person-outline";
          }

          return <MaterialIcons name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: "#ef4444",
        tabBarInactiveTintColor: "#9ca3af",
        tabBarStyle: {
          backgroundColor: "#111827",
          borderTopColor: "#1f2937",
        },
        headerShown: false,
      })}
    >
      <Tab.Screen name="Dashboard" component={AnalyticsTab} />
      <Tab.Screen name="Analytics" component={AnalyticsTab} />
      <Tab.Screen name="Promotions" component={PromotionsTab} />
      <Tab.Screen name="Profile">
        {() => (
          <Profile
            onLogout={() => {
              SecureStore.deleteItemAsync("authToken");
              setToken(null);
              setUser(null);
            }}
          />
        )}
      </Tab.Screen>
    </Tab.Navigator>
  );

  // RSVP Modal
  const RSVPModal = () => (
    <Modal visible={showRSVPModal} animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>RSVP to Event</Text>
            <TouchableOpacity onPress={() => setShowRSVPModal(false)}>
              <MaterialIcons name="close" size={24} color="#ef4444" />
            </TouchableOpacity>
          </View>

          {selectedEvent && (
            <>
              <Text style={styles.eventTitle}>{selectedEvent.title}</Text>
              <Text style={styles.eventLocation}>
                {venues.find((v) => v.id === selectedEvent.venueId)?.name}
              </Text>

              <Text style={styles.sectionTitle}>Select Ticket Type</Text>
              <ScrollView style={styles.ticketTypesContainer}>
                {selectedEvent.ticketTypes.map((ticket) => (
                  <TouchableOpacity
                    key={ticket.name}
                    style={[
                      styles.ticketType,
                      selectedTicketType?.name === ticket.name &&
                        styles.selectedTicketType,
                    ]}
                    onPress={() => setSelectedTicketType(ticket)}
                  >
                    <View style={styles.ticketInfo}>
                      <Text style={styles.ticketName}>{ticket.name}</Text>
                      <Text style={styles.ticketPrice}>
                        {ticket.price === 0 ? "FREE" : `$${ticket.price}`}
                      </Text>
                    </View>
                    <Text style={styles.ticketPerks}>
                      {ticket.perks.join(" • ")}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <Text style={styles.sectionTitle}>Number of Guests</Text>
              <View style={styles.guestCountContainer}>
                {[1, 2, 3, 4, 5].map((num) => (
                  <TouchableOpacity
                    key={num}
                    style={[
                      styles.guestCountOption,
                      guestCount === num && styles.selectedGuestCount,
                    ]}
                    onPress={() => setGuestCount(num)}
                  >
                    <Text
                      style={
                        guestCount === num
                          ? styles.selectedGuestCountText
                          : styles.guestCountText
                      }
                    >
                      {num}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TouchableOpacity
                style={styles.confirmButton}
                onPress={handleRSVP}
                disabled={!selectedTicketType || loading}
              >
                {loading ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text style={styles.confirmButtonText}>Confirm RSVP</Text>
                )}
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </Modal>
  );

  // Main render
  if (!token) {
    return <AuthScreen onLogin={() => setAppMode("consumer")} />;
  }

  return (
    <NavigationContainer>
      {/* View Mode Toggle for promoter */}
      {user?.role === "venue_manager" && (
        <View style={styles.modeToggleContainer}>
          <TouchableOpacity
            style={[
              styles.modeButton,
              appMode === "consumer" && styles.activeModeButton,
            ]}
            onPress={() => setAppMode("consumer")}
          >
            <Text
              style={[
                styles.modeButtonText,
                appMode === "consumer" && styles.activeModeButtonText,
              ]}
            >
              Consumer
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.modeButton,
              appMode === "promoter" && styles.activeModeButton,
            ]}
            onPress={() => setAppMode("promoter")}
          >
            <Text
              style={[
                styles.modeButtonText,
                appMode === "promoter" && styles.activeModeButtonText,
              ]}
            >
              Promoter
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Render the appropriate app */}
      {appMode === "consumer" ? <ConsumerApp /> : <PromoterApp />}

      {/* Modals */}
      <RSVPModal />
    </NavigationContainer>
  );
};

const styles = StyleSheet.create({
  // Base styles
  container: {
    flex: 1,
    backgroundColor: "#111827",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#111827",
  },

  // Auth styles
  authContainer: {
    flex: 1,
    backgroundColor: "#111827",
    justifyContent: "center",
    padding: 20,
  },
  authHeader: {
    marginBottom: 40,
    alignItems: "center",
  },
  authTitle: {
    fontSize: 32,
    fontWeight: "bold",
    color: "white",
  },
  authSubtitle: {
    fontSize: 14,
    color: "#ef4444",
    textTransform: "uppercase",
    letterSpacing: 2,
  },
  authError: {
    color: "#ef4444",
    marginBottom: 15,
    textAlign: "center",
  },
  authInput: {
    backgroundColor: "#1f2937",
    color: "white",
    padding: 15,
    borderRadius: 8,
    marginBottom: 15,
    fontSize: 16,
  },
  authButton: {
    backgroundColor: "#ef4444",
    padding: 15,
    borderRadius: 8,
    alignItems: "center",
  },
  authButtonText: {
    color: "white",
    fontWeight: "bold",
    fontSize: 16,
  },
  authToggle: {
    marginTop: 20,
    alignItems: "center",
  },
  authToggleText: {
    color: "#9ca3af",
    fontSize: 14,
  },

  // Map styles
  mapContainer: {
    flex: 1,
    backgroundColor: "#111827",
  },
  mapBackground: {
    flex: 1,
    backgroundColor: "#1f2937",
    position: "relative",
  },
  mapPin: {
    position: "absolute",
    alignItems: "center",
  },
  pinCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  pinBadge: {
    position: "absolute",
    top: -5,
    right: -5,
    backgroundColor: "white",
    borderRadius: 10,
    width: 20,
    height: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  pinBadgeText: {
    color: "#111827",
    fontSize: 10,
    fontWeight: "bold",
  },
  scoreDisplay: {
    marginTop: 5,
    backgroundColor: "rgba(0,0,0,0.7)",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  scoreText: {
    color: "white",
    fontSize: 12,
    fontWeight: "bold",
  },

  // Modal styles
  modalOverlay: {
    flex: 1,
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.7)",
  },
  venueModal: {
    backgroundColor: "#1f2937",
    margin: 20,
    borderRadius: 10,
    padding: 20,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 15,
  },
  venueTitle: {
    color: "white",
    fontSize: 20,
    fontWeight: "bold",
  },
  venueSubtitle: {
    color: "#9ca3af",
    fontSize: 14,
  },
  venueStats: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginVertical: 15,
  },
  statItem: {
    flexDirection: "row",
    alignItems: "center",
  },
  statText: {
    color: "white",
    marginLeft: 5,
  },
  promoCard: {
    backgroundColor: "rgba(239, 68, 68, 0.1)",
    borderColor: "#ef4444",
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 15,
  },
  promoText: {
    color: "white",
    marginLeft: 10,
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  checkInButton: {
    backgroundColor: "#ef4444",
    padding: 15,
    borderRadius: 8,
    flex: 1,
    marginRight: 10,
    alignItems: "center",
  },
  checkedInButton: {
    backgroundColor: "#166534",
  },
  checkInText: {
    color: "white",
    fontWeight: "bold",
  },
  cameraButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: "#1f2937",
    borderColor: "#ef4444",
    borderWidth: 1,
    justifyContent: "center",
    alignItems: "center",
  },

  // Venue list styles
  venueList: {
    flex: 1,
    backgroundColor: "#111827",
  },
  listHeader: {
    padding: 15,
  },
  listTitle: {
    color: "white",
    fontSize: 22,
    fontWeight: "bold",
    marginBottom: 15,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1f2937",
    borderRadius: 8,
    paddingHorizontal: 15,
    paddingVertical: 10,
  },
  searchIcon: {
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    color: "white",
    fontSize: 16,
  },
  venueCards: {
    paddingHorizontal: 15,
    paddingBottom: 15,
  },
  venueCard: {
    backgroundColor: "#1f2937",
    borderRadius: 12,
    padding: 15,
    marginBottom: 15,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  venueName: {
    color: "white",
    fontSize: 18,
    fontWeight: "bold",
  },
  venueType: {
    color: "#9ca3af",
    fontSize: 14,
  },
  cardRight: {
    alignItems: "flex-end",
  },
  scoreContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
  scoreValue: {
    color: "white",
    marginLeft: 5,
  },
  distance: {
    color: "#9ca3af",
    fontSize: 12,
    marginTop: 5,
  },
  cardStats: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 15,
  },
  cardStatsLeft: {
    flexDirection: "row",
  },
  statPair: {
    flexDirection: "row",
    alignItems: "center",
    marginRight: 15,
  },
  statSmall: {
    color: "white",
    marginLeft: 5,
    fontSize: 12,
  },
  promoIndicator: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(239, 68, 68, 0.1)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  promoLabel: {
    color: "#ef4444",
    fontSize: 12,
    marginLeft: 5,
  },
  venueCheckInButton: {
    backgroundColor: "#ef4444",
    padding: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  venueCheckedInButton: {
    backgroundColor: "#166534",
  },
  venueCheckInText: {
    color: "white",
    fontWeight: "bold",
  },

  // Event styles
  eventCard: {
    backgroundColor: "#1f2937",
    borderRadius: 12,
    marginBottom: 15,
    overflow: "hidden",
  },
  eventImageContainer: {
    height: 160,
    position: "relative",
  },
  eventImage: {
    flex: 1,
    width: "100%",
  },
  eventDateBadge: {
    position: "absolute",
    top: 10,
    left: 10,
    backgroundColor: "rgba(0,0,0,0.7)",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#ef4444",
  },
  eventDateText: {
    color: "white",
    fontSize: 12,
    fontWeight: "bold",
  },
  eventDetails: {
    padding: 15,
  },
  eventTitle: {
    color: "white",
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 10,
  },
  eventMeta: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 5,
  },
  eventLocation: {
    color: "#9ca3af",
    marginLeft: 5,
    fontSize: 14,
  },
  eventTime: {
    color: "#9ca3af",
    marginLeft: 5,
    fontSize: 14,
  },
  eventDescription: {
    color: "#9ca3af",
    fontSize: 14,
    marginTop: 10,
    marginBottom: 15,
  },
  ticketPreview: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 10,
  },
  ticketType: {
    alignItems: "center",
    flex: 1,
    marginHorizontal: 5,
  },
  ticketPrice: {
    color: "#ef4444",
    fontWeight: "bold",
    fontSize: 16,
  },
  ticketName: {
    color: "#9ca3af",
    fontSize: 12,
    marginTop: 5,
  },
  listContent: {
    padding: 15,
  },

  // RSVP styles
  rsvpListContent: {
    padding: 15,
  },
  rsvpCard: {
    backgroundColor: "#1f2937",
    borderRadius: 12,
    padding: 15,
    marginBottom: 15,
  },
  rsvpHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  rsvpEventTitle: {
    color: "white",
    fontSize: 16,
    fontWeight: "bold",
  },
  rsvpStatusBadge: {
    backgroundColor: "#166534",
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
  },
  rsvpStatusText: {
    color: "#4ade80",
    fontSize: 10,
    fontWeight: "bold",
  },
  rsvpDetails: {
    marginBottom: 10,
  },
  rsvpDetailRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 5,
  },
  rsvpDetailText: {
    color: "#9ca3af",
    fontSize: 14,
    marginLeft: 5,
  },
  rsvpFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 15,
  },
  rsvpTicketType: {
    color: "#ef4444",
    fontSize: 14,
  },
  rsvpGuestCount: {
    color: "#9ca3af",
    fontSize: 14,
  },
  rsvpActions: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  rsvpActionButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
  },
  rsvpActionText: {
    color: "#3b82f6",
    marginLeft: 5,
    fontSize: 14,
  },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  emptyStateText: {
    color: "#9ca3af",
    fontSize: 18,
    marginTop: 15,
  },
  emptyStateSubtext: {
    color: "#6b7280",
    fontSize: 14,
    marginTop: 5,
    marginBottom: 20,
  },
  browseButton: {
    backgroundColor: "#ef4444",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  browseButtonText: {
    color: "white",
    fontWeight: "bold",
  },

  // Photo feed styles
  photoFeed: {
    flex: 1,
    backgroundColor: "#111827",
  },
  photoHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 15,
  },
  photoTitle: {
    color: "white",
    fontSize: 22,
    fontWeight: "bold",
  },
  addPhotoButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#ef4444",
    justifyContent: "center",
    alignItems: "center",
  },
  photoGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    padding: 5,
  },
  photoCard: {
    width: "50%",
    padding: 5,
    aspectRatio: 1,
  },
  photoPlaceholder: {
    flex: 1,
    backgroundColor: "#1f2937",
    justifyContent: "center",
    alignItems: "center",
  },
  photoOverlay: {
    position: "absolute",
    bottom: 5,
    left: 5,
    right: 5,
    padding: 10,
    backgroundColor: "rgba(0,0,0,0.7)",
  },
  photoInfo: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  photoLocation: {
    flexDirection: "row",
    alignItems: "center",
  },
  photoLocationText: {
    color: "white",
    fontSize: 12,
    marginLeft: 5,
  },
  photoLikes: {
    flexDirection: "row",
    alignItems: "center",
  },
  photoLikesText: {
    color: "white",
    fontSize: 12,
    marginLeft: 5,
  },

  // Profile styles
  profile: {
    flex: 1,
    backgroundColor: "#111827",
  },
  profileHeader: {
    alignItems: "center",
    padding: 20,
  },
  profileAvatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: "#1f2937",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 15,
  },
  profileName: {
    color: "white",
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 5,
  },
  profileRole: {
    color: "#9ca3af",
    fontSize: 16,
  },
  profileStats: {
    flexDirection: "row",
    justifyContent: "space-around",
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: "#1f2937",
  },
  profileStat: {
    alignItems: "center",
  },
  profileStatLabel: {
    color: "#9ca3af",
    fontSize: 14,
  },
  profileStatValue: {
    color: "white",
    fontSize: 20,
    fontWeight: "bold",
    marginTop: 5,
  },
  editProfileButton: {
    backgroundColor: "#1f2937",
    margin: 20,
    padding: 15,
    borderRadius: 8,
    alignItems: "center",
  },
  editProfileText: {
    color: "white",
    fontWeight: "bold",
  },
  logoutButton: {
    backgroundColor: "#ef4444",
    margin: 20,
    padding: 15,
    borderRadius: 8,
    alignItems: "center",
  },
  logoutButtonText: {
    color: "white",
    fontWeight: "bold",
  },

  // Dashboard styles
  dashboardContent: {
    flex: 1,
    backgroundColor: "#111827",
    padding: 15,
  },
  dashboardTitle: {
    color: "white",
    fontSize: 22,
    fontWeight: "bold",
    marginBottom: 20,
  },
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  statCard: {
    backgroundColor: "#1f2937",
    borderRadius: 10,
    padding: 15,
    width: "30%",
    alignItems: "center",
  },
  statValue: {
    color: "white",
    fontSize: 24,
    fontWeight: "bold",
  },
  statLabel: {
    color: "#9ca3af",
    fontSize: 12,
    marginTop: 5,
  },
  chartTitle: {
    color: "white",
    fontSize: 16,
    fontWeight: "bold",
    marginBottom: 10,
  },
  chart: {
    marginVertical: 10,
    borderRadius: 16,
  },
  promoHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 15,
  },
  addButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#ef4444",
    justifyContent: "center",
    alignItems: "center",
  },
  promoCard: {
    backgroundColor: "#1f2937",
    borderRadius: 10,
    padding: 15,
    marginBottom: 15,
  },
  promoCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  promoTitle: {
    color: "white",
    fontSize: 16,
    fontWeight: "bold",
  },
  toggleButton: {
    backgroundColor: "#374151",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
  },
  toggleButtonActive: {
    backgroundColor: "#166534",
  },
  toggleButtonText: {
    color: "white",
    fontSize: 12,
    fontWeight: "bold",
  },
  promoDescription: {
    color: "#9ca3af",
    fontSize: 14,
    marginBottom: 10,
  },
  promoDetails: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  promoDetail: {
    color: "#9ca3af",
    fontSize: 12,
  },
  promoRedemptions: {
    color: "#ef4444",
    fontSize: 12,
  },
  promoModal: {
    backgroundColor: "#1f2937",
    margin: 20,
    borderRadius: 10,
    maxHeight: "80%",
  },
  modalContent: {
    padding: 20,
  },
  input: {
    backgroundColor: "#374151",
    color: "white",
    padding: 15,
    borderRadius: 8,
    marginBottom: 15,
    fontSize: 16,
  },
  timeInputs: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  timeInput: {
    width: "48%",
  },
  promoTypeContainer: {
    marginBottom: 15,
  },
  label: {
    color: "white",
    marginBottom: 10,
    fontSize: 16,
  },
  radioGroup: {
    flexDirection: "row",
  },
  radioButton: {
    flexDirection: "row",
    alignItems: "center",
    marginRight: 20,
  },
  radioCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#ef4444",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 5,
  },
  radioDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#ef4444",
  },
  radioLabel: {
    color: "white",
  },
  discountInput: {
    marginBottom: 15,
  },
  daysContainer: {
    marginBottom: 15,
  },
  daysGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  dayButton: {
    width: "30%",
    backgroundColor: "#374151",
    padding: 10,
    borderRadius: 8,
    marginBottom: 10,
    alignItems: "center",
  },
  dayButtonSelected: {
    backgroundColor: "#ef4444",
  },
  dayButtonText: {
    color: "white",
  },
  modalFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 15,
    borderTopWidth: 1,
    borderTopColor: "#374151",
  },
  cancelButton: {
    backgroundColor: "#374151",
    padding: 15,
    borderRadius: 8,
    flex: 1,
    marginRight: 10,
    alignItems: "center",
  },
  cancelButtonText: {
    color: "white",
    fontWeight: "bold",
  },
  createButton: {
    backgroundColor: "#ef4444",
    padding: 15,
    borderRadius: 8,
    flex: 1,
    alignItems: "center",
  },
  createButtonText: {
    color: "white",
    fontWeight: "bold",
  },

  // RSVP Modal styles
  modalContent: {
    backgroundColor: "#1f2937",
    margin: 20,
    borderRadius: 10,
    padding: 20,
    maxHeight: "80%",
  },
  modalTitle: {
    color: "white",
    fontSize: 20,
    fontWeight: "bold",
  },
  eventTitle: {
    color: "white",
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 5,
  },
  eventLocation: {
    color: "#9ca3af",
    fontSize: 14,
    marginBottom: 15,
  },
  sectionTitle: {
    color: "white",
    fontSize: 16,
    fontWeight: "bold",
    marginBottom: 10,
  },
  ticketTypesContainer: {
    maxHeight: 150,
    marginBottom: 10,
  },
  ticketType: {
    backgroundColor: "#374151",
    padding: 15,
    borderRadius: 8,
    marginBottom: 10,
  },
  selectedTicketType: {
    borderColor: "#ef4444",
    borderWidth: 1,
  },
  ticketInfo: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 5,
  },
  ticketName: {
    color: "white",
    fontSize: 16,
  },
  ticketPrice: {
    color: "#ef4444",
    fontSize: 16,
    fontWeight: "bold",
  },
  ticketPerks: {
    color: "#9ca3af",
    fontSize: 12,
  },
  guestCountContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  guestCountOption: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#374151",
    justifyContent: "center",
    alignItems: "center",
  },
  selectedGuestCount: {
    backgroundColor: "#ef4444",
  },
  guestCountText: {
    color: "white",
  },
  selectedGuestCountText: {
    color: "white",
    fontWeight: "bold",
  },
  confirmButton: {
    backgroundColor: "#ef4444",
    padding: 15,
    borderRadius: 8,
    alignItems: "center",
  },
  confirmButtonText: {
    color: "white",
    fontWeight: "bold",
  },

  // Mode toggle
  modeToggleContainer: {
    flexDirection: "row",
    backgroundColor: "#1f2937",
    borderRadius: 25,
    padding: 2,
    margin: 15,
    alignSelf: "center",
  },
  modeButton: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 20,
  },
  activeModeButton: {
    backgroundColor: "#ef4444",
  },
  modeButtonText: {
    color: "#9ca3af",
    fontWeight: "bold",
  },
  activeModeButtonText: {
    color: "white",
  },
});

export default SceneAppComplete;
