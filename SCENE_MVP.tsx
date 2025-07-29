import React, { useState, useEffect } from 'react';
import { 
  MapPin, Users, Heart, Camera, Star, Clock, Gift, Plus, Search, Menu, User, Bell,
  BarChart3, TrendingUp, Eye, Edit, Save, X, Calendar, DollarSign, Settings,
  Upload, Image, Trash2, ChevronDown, Filter
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';

const SceneAppComplete = () => {
  const [viewMode, setViewMode] = useState('customer'); // 'customer' or 'venue'
  
  // Customer App Component
  const SceneApp = () => {
    const [activeTab, setActiveTab] = useState('map');
    const [venues, setVenues] = useState([
      {
        id: 1,
        name: "Midnight Lounge",
        location: "Downtown",
        checkedIn: 47,
        sceneScore: 9.2,
        photos: 12,
        hasPromo: true,
        distance: "0.2 mi",
        type: "Nightclub"
      },
      {
        id: 2,
        name: "Red Room Bar",
        location: "Arts District",
        checkedIn: 23,
        sceneScore: 7.8,
        photos: 8,
        hasPromo: false,
        distance: "0.5 mi",
        type: "Bar"
      },
      {
        id: 3,
        name: "Club Pulse",
        location: "Uptown",
        checkedIn: 89,
        sceneScore: 9.7,
        photos: 24,
        hasPromo: true,
        distance: "1.2 mi",
        type: "Nightclub"
      }
    ]);

    const [userCheckedIn, setUserCheckedIn] = useState(null);
    const [selectedVenue, setSelectedVenue] = useState(null);

    const handleCheckIn = (venueId) => {
      if (userCheckedIn === venueId) {
        setUserCheckedIn(null);
      } else {
        setUserCheckedIn(venueId);
        setVenues(prev => prev.map(v => 
          v.id === venueId 
            ? { ...v, checkedIn: v.checkedIn + (userCheckedIn ? 0 : 1) }
            : v
        ));
      }
    };

    const SceneMap = () => (
      <div className="relative h-full bg-gray-900">
        <div className="absolute inset-0 bg-gradient-to-br from-gray-800 to-black">
          <div className="w-full h-full relative overflow-hidden">
            {venues.map((venue, index) => (
              <div
                key={venue.id}
                className={`absolute cursor-pointer transform transition-all duration-300 hover:scale-110`}
                style={{
                  left: `${20 + index * 25}%`,
                  top: `${30 + index * 20}%`
                }}
                onClick={() => setSelectedVenue(venue)}
              >
                <div className="relative">
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center border-2 ${
                    venue.sceneScore > 9 ? 'bg-red-500 border-red-400' : 
                    venue.sceneScore > 8 ? 'bg-red-600 border-red-500' : 
                    'bg-red-700 border-red-600'
                  } shadow-lg`}>
                    <Users className="w-6 h-6 text-white" />
                  </div>
                  <div className="absolute -top-2 -right-2 bg-black border border-red-500 rounded-full w-8 h-8 flex items-center justify-center">
                    <span className="text-red-400 text-xs font-bold">{venue.checkedIn}</span>
                  </div>
                  <div className="absolute -bottom-8 left-1/2 transform -translate-x-1/2 bg-black/80 backdrop-blur-sm border border-red-500/30 rounded-lg px-2 py-1">
                    <span className="text-red-400 text-xs font-bold">{venue.sceneScore}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="absolute top-0 left-0 right-0 bg-black/90 backdrop-blur-sm border-b border-red-900/30 p-4 z-10">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <Menu className="w-6 h-6 text-red-400" />
              <h1 className="text-xl font-bold text-white">Scene</h1>
            </div>
            <div className="flex items-center space-x-3">
              <Search className="w-6 h-6 text-red-400" />
              <Bell className="w-6 h-6 text-red-400" />
              <User className="w-6 h-6 text-red-400" />
            </div>
          </div>
        </div>

        {selectedVenue && (
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-end z-20">
            <div className="w-full bg-black border-t border-red-900/30 rounded-t-3xl p-6 max-h-80 overflow-y-auto">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="text-xl font-bold text-white">{selectedVenue.name}</h3>
                  <p className="text-red-400">{selectedVenue.location} • {selectedVenue.distance}</p>
                </div>
                <button 
                  onClick={() => setSelectedVenue(null)}
                  className="text-red-400 text-2xl"
                >
                  ×
                </button>
              </div>
              
              <div className="flex items-center space-x-4 mb-4">
                <div className="flex items-center space-x-1">
                  <Star className="w-5 h-5 text-red-400" />
                  <span className="text-white font-bold">{selectedVenue.sceneScore}</span>
                </div>
                <div className="flex items-center space-x-1">
                  <Users className="w-5 h-5 text-red-400" />
                  <span className="text-white">{selectedVenue.checkedIn} here now</span>
                </div>
                <div className="flex items-center space-x-1">
                  <Camera className="w-5 h-5 text-red-400" />
                  <span className="text-white">{selectedVenue.photos} photos</span>
                </div>
              </div>

              {selectedVenue.hasPromo && (
                <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-3 mb-4">
                  <div className="flex items-center space-x-2">
                    <Gift className="w-5 h-5 text-red-400" />
                    <span className="text-red-400 font-semibold">Active Promo: 25% off drinks until 11 PM</span>
                  </div>
                </div>
              )}

              <div className="flex space-x-3">
                <button
                  onClick={() => handleCheckIn(selectedVenue.id)}
                  className={`flex-1 py-3 rounded-lg font-semibold transition-colors ${
                    userCheckedIn === selectedVenue.id
                      ? 'bg-red-600 text-white'
                      : 'bg-red-500 hover:bg-red-600 text-white'
                  }`}
                >
                  {userCheckedIn === selectedVenue.id ? 'Checked In' : 'Check In'}
                </button>
                <button className="px-4 py-3 bg-gray-800 hover:bg-gray-700 text-red-400 rounded-lg transition-colors">
                  <Camera className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );

    const VenueList = () => (
      <div className="h-full bg-black overflow-y-auto">
        <div className="p-4 border-b border-red-900/30">
          <h2 className="text-xl font-bold text-white mb-3">Venues Near You</h2>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-red-400" />
            <input
              type="text"
              placeholder="Search venues..."
              className="w-full pl-10 pr-4 py-2 bg-gray-900 border border-red-900/30 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-red-500"
            />
          </div>
        </div>

        <div className="p-4 space-y-4">
          {venues.map((venue) => (
            <div key={venue.id} className="bg-gray-900 border border-red-900/30 rounded-lg p-4">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h3 className="text-white font-semibold">{venue.name}</h3>
                  <p className="text-gray-400 text-sm">{venue.type} • {venue.location}</p>
                </div>
                <div className="text-right">
                  <div className="flex items-center space-x-1">
                    <Star className="w-4 h-4 text-red-400" />
                    <span className="text-white font-bold">{venue.sceneScore}</span>
                  </div>
                  <p className="text-gray-400 text-sm">{venue.distance}</p>
                </div>
              </div>

              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center space-x-4">
                  <div className="flex items-center space-x-1">
                    <Users className="w-4 h-4 text-red-400" />
                    <span className="text-white text-sm">{venue.checkedIn}</span>
                  </div>
                  <div className="flex items-center space-x-1">
                    <Camera className="w-4 h-4 text-red-400" />
                    <span className="text-white text-sm">{venue.photos}</span>
                  </div>
                </div>
                {venue.hasPromo && (
                  <div className="flex items-center space-x-1">
                    <Gift className="w-4 h-4 text-red-400" />
                    <span className="text-red-400 text-sm font-semibold">Promo</span>
                  </div>
                )}
              </div>

              <button
                onClick={() => handleCheckIn(venue.id)}
                className={`w-full py-2 rounded-lg text-sm font-semibold transition-colors ${
                  userCheckedIn === venue.id
                    ? 'bg-red-600 text-white'
                    : 'bg-red-500 hover:bg-red-600 text-white'
                }`}
              >
                {userCheckedIn === venue.id ? 'Checked In' : 'Check In'}
              </button>
            </div>
          ))}
        </div>
      </div>
    );

    const PhotoFeed = () => (
      <div className="h-full bg-black overflow-y-auto">
        <div className="p-4 border-b border-red-900/30">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-bold text-white">Scene Photos</h2>
            <button className="bg-red-500 hover:bg-red-600 text-white p-2 rounded-lg transition-colors">
              <Plus className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-1">
          {[1,2,3,4,5,6,7,8].map((i) => (
            <div key={i} className="aspect-square bg-gray-900 relative group">
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                <div className="absolute bottom-2 left-2 right-2">
                  <div className="flex items-center justify-between text-white">
                    <div className="flex items-center space-x-2">
                      <MapPin className="w-4 h-4 text-red-400" />
                      <span className="text-sm">Midnight Lounge</span>
                    </div>
                    <div className="flex items-center space-x-1">
                      <Heart className="w-4 h-4 text-red-400" />
                      <span className="text-sm">{Math.floor(Math.random() * 50) + 10}</span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="w-full h-full bg-gradient-to-br from-red-900/20 to-gray-800 flex items-center justify-center">
                <Camera className="w-8 h-8 text-red-400/50" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );

    const Profile = () => (
      <div className="h-full bg-black overflow-y-auto">
        <div className="p-4">
          <div className="text-center mb-6">
            <div className="w-20 h-20 bg-red-500 rounded-full mx-auto mb-3 flex items-center justify-center">
              <User className="w-10 h-10 text-white" />
            </div>
            <h2 className="text-xl font-bold text-white">Your Profile</h2>
            <p className="text-gray-400">Scene Explorer</p>
          </div>

          <div className="space-y-4">
            <div className="bg-gray-900 border border-red-900/30 rounded-lg p-4">
              <div className="flex justify-between items-center">
                <span className="text-white">Total Check-ins</span>
                <span className="text-red-400 font-bold">47</span>
              </div>
            </div>
            
            <div className="bg-gray-900 border border-red-900/30 rounded-lg p-4">
              <div className="flex justify-between items-center">
                <span className="text-white">Photos Shared</span>
                <span className="text-red-400 font-bold">23</span>
              </div>
            </div>
            
            <div className="bg-gray-900 border border-red-900/30 rounded-lg p-4">
              <div className="flex justify-between items-center">
                <span className="text-white">Scene Score</span>
                <span className="text-red-400 font-bold">8.9</span>
              </div>
            </div>

            <button className="w-full py-3 bg-red-500 hover:bg-red-600 text-white rounded-lg font-semibold transition-colors">
              Edit Profile
            </button>
          </div>
        </div>
      </div>
    );

    return (
      <div className="max-w-md mx-auto h-screen bg-black flex flex-col">
        <div className="flex-1 overflow-hidden">
          {activeTab === 'map' && <SceneMap />}
          {activeTab === 'venues' && <VenueList />}
          {activeTab === 'photos' && <PhotoFeed />}
          {activeTab === 'profile' && <Profile />}
        </div>

        <div className="bg-black border-t border-red-900/30 p-2">
          <div className="flex justify-around">
            {[
              { id: 'map', icon: MapPin, label: 'Map' },
              { id: 'venues', icon: Users, label: 'Venues' },
              { id: 'photos', icon: Camera, label: 'Photos' },
              { id: 'profile', icon: User, label: 'Profile' }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex flex-col items-center py-2 px-4 rounded-lg transition-colors ${
                  activeTab === tab.id
                    ? 'text-red-400 bg-red-900/20'
                    : 'text-gray-400 hover:text-red-400'
                }`}
              >
                <tab.icon className="w-6 h-6 mb-1" />
                <span className="text-xs">{tab.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  };

  // Venue Dashboard Component
  const VenueDashboard = () => {
    const [activeTab, setActiveTab] = useState('overview');
    const [showPromoModal, setShowPromoModal] = useState(false);
    const [venue, setVenue] = useState({
      name: "Midnight Lounge",
      address: "123 Downtown Blvd, City Center",
      type: "Nightclub",
      sceneScore: 9.2,
      totalCheckins: 1247,
      currentCheckins: 47,
      totalPhotos: 89,
      verified: true
    });

    const [analytics, setAnalytics] = useState({
      weeklyCheckins: [
        { day: 'Mon', checkins: 23 },
        { day: 'Tue', checkins: 18 },
        { day: 'Wed', checkins: 31 },
        { day: 'Thu', checkins: 45 },
        { day: 'Fri', checkins: 89 },
        { day: 'Sat', checkins: 156 },
        { day: 'Sun', checkins: 67 }
      ],
      hourlyData: [
        { hour: '6PM', users: 12 },
        { hour: '7PM', users: 28 },
        { hour: '8PM', users: 45 },
        { hour: '9PM', users: 67 },
        { hour: '10PM', users: 89 },
        { hour: '11PM', users: 112 },
        { hour: '12AM', users: 134 },
        { hour: '1AM', users: 98 },
        { hour: '2AM', users: 45 }
      ]
    });

    const [promos, setPromos] = useState([
      {
        id: 1,
        title: "Happy Hour Special",
        description: "25% off all drinks",
        startTime: "18:00",
        endTime: "20:00",
        active: true,
        redemptions: 23,
        type: "discount"
      },
      {
        id: 2,
        title: "Ladies Night",
        description: "Free cocktails for ladies",
        startTime: "21:00",
        endTime: "23:00",
        active: false,
        redemptions: 0,
        type: "free"
      }
    ]);

    const [photos, setPhotos] = useState([
      { id: 1, likes: 45, views: 234, uploaded: "2 hours ago", featured: true },
      { id: 2, likes: 32, views: 189, uploaded: "5 hours ago", featured: false },
      { id: 3, likes: 67, views: 321, uploaded: "1 day ago", featured: true },
      { id: 4, likes: 28, views: 156, uploaded: "2 days ago", featured: false },
      { id: 5, likes: 89, views: 445, uploaded: "3 days ago", featured: true },
      { id: 6, likes: 23, views: 134, uploaded: "4 days ago", featured: false }
    ]);

    const [newPromo, setNewPromo] = useState({
      title: '',
      description: '',
      startTime: '',
      endTime: '',
      type: 'discount'
    });

    const Header = () => (
      <header className="bg-black border-b border-red-900/30 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-red-500 rounded-lg flex items-center justify-center">
                <BarChart3 className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white">Scene Dashboard</h1>
                <p className="text-red-400">{venue.name}</p>
              </div>
            </div>
          </div>
          <div className="flex items-center space-x-4">
            <button className="p-2 text-red-400 hover:bg-red-900/20 rounded-lg transition-colors">
              <Bell className="w-5 h-5" />
            </button>
            <button className="p-2 text-red-400 hover:bg-red-900/20 rounded-lg transition-colors">
              <Settings className="w-5 h-5" />
            </button>
            <div className="flex items-center space-x-2 bg-gray-900 px-3 py-2 rounded-lg">
              <div className="w-8 h-8 bg-red-500 rounded-full flex items-center justify-center">
                <span className="text-white text-sm font-bold">ML</span>
              </div>
              <span className="text-white text-sm">Manager</span>
            </div>
          </div>
        </div>
      </header>
    );

    const Sidebar = () => (
      <aside className="w-64 bg-gray-900 border-r border-red-900/30 h-full">
        <div className="p-6">
          <div className="space-y-2">
            {[
              { id: 'overview', icon: BarChart3, label: 'Overview' },
              { id: 'checkins', icon: Users, label: 'Check-ins' },
              { id: 'promos', icon: Gift, label: 'Promotions' },
              { id: 'photos', icon: Camera, label: 'Photos' },
              { id: 'analytics', icon: TrendingUp, label: 'Analytics' },
              { id: 'settings', icon: Settings, label: 'Settings' }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors ${
                  activeTab === tab.id
                    ? 'bg-red-500 text-white'
                    : 'text-gray-400 hover:text-white hover:bg-gray-800'
                }`}
              >
                <tab.icon className="w-5 h-5" />
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
        </div>
      </aside>
    );

    const StatsCard = ({ title, value, change, icon: Icon, color = "red" }) => (
      <div className="bg-gray-900 border border-red-900/30 rounded-lg p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-gray-400 text-sm">{title}</p>
            <p className="text-2xl font-bold text-white">{value}</p>
            {change && (
              <p className={`text-sm flex items-center space-x-1 ${
                change > 0 ? 'text-green-400' : 'text-red-400'
              }`}>
                <TrendingUp className="w-4 h-4" />
                <span>{change > 0 ? '+' : ''}{change}%</span>
              </p>
            )}
          </div>
          <div className={`w-12 h-12 bg-red-500/20 rounded-lg flex items-center justify-center`}>
            <Icon className={`w-6 h-6 text-red-400`} />
          </div>
        </div>
      </div>
    );

    const Overview = () => (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatsCard
            title="Scene Score"
            value={venue.sceneScore}
            change={12}
            icon={Star}
          />
          <StatsCard
            title="Currently Here"
            value={venue.currentCheckins}
            change={8}
            icon={Users}
          />
          <StatsCard
            title="Total Check-ins"
            value={venue.totalCheckins.toLocaleString()}
            change={23}
            icon={MapPin}
          />
          <StatsCard
            title="Photos Shared"
            value={venue.totalPhotos}
            change={15}
            icon={Camera}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-gray-900 border border-red-900/30 rounded-lg p-6">
            <h3 className="text-xl font-bold text-white mb-4">Weekly Check-ins</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={analytics.weeklyCheckins}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="day" stroke="#9CA3AF" />
                <YAxis stroke="#9CA3AF" />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: '#1F2937', 
                    border: '1px solid #DC2626',
                    borderRadius: '8px'
                  }} 
                />
                <Bar dataKey="checkins" fill="#DC2626" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-gray-900 border border-red-900/30 rounded-lg p-6">
            <h3 className="text-xl font-bold text-white mb-4">Today's Traffic</h3>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={analytics.hourlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="hour" stroke="#9CA3AF" />
                <YAxis stroke="#9CA3AF" />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: '#1F2937', 
                    border: '1px solid #DC2626',
                    borderRadius: '8px'
                  }} 
                />
                <Line type="monotone" dataKey="users" stroke="#DC2626" strokeWidth={3} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-gray-900 border border-red-900/30 rounded-lg p-6">
          <h3 className="text-xl font-bold text-white mb-4">Active Promotions</h3>
          <div className="space-y-3">
            {promos.filter(p => p.active).map((promo) => (
              <div key={promo.id} className="flex items-center justify-between bg-black/50 p-4 rounded-lg border border-red-900/30">
                <div className="flex items-center space-x-3">
                  <Gift className="w-5 h-5 text-red-400" />
                  <div>
                    <h4 className="text-white font-semibold">{promo.title}</h4>
                    <p className="text-gray-400 text-sm">{promo.description}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-red-400 font-bold">{promo.redemptions} used</p>
                  <p className="text-gray-400 text-sm">{promo.startTime} - {promo.endTime}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );

    const Promotions = () => (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h2 className="text-2xl font-bold text-white">Promotions</h2>
          <button
            onClick={() => setShowPromoModal(true)}
            className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg flex items-center space-x-2 transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Create Promo</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {promos.map((promo) => (
            <div key={promo.id} className="bg-gray-900 border border-red-900/30 rounded-lg p-6">
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center space-x-2">
                  <Gift className="w-5 h-5 text-red-400" />
                  <h3 className="text-white font-semibold">{promo.title}</h3>
                </div>
                <div className="flex items-center space-x-2">
                  <span className={`px-2 py-1 rounded-full text-xs ${
                    promo.active ? 'bg-green-900/30 text-green-400' : 'bg-gray-800 text-gray-400'
                  }`}>
                    {promo.active ? 'Active' : 'Inactive'}
                  </span>
                  <button className="text-gray-400 hover:text-white">
                    <Edit className="w-4 h-4" />
                  </button>
                </div>
              </div>
              
              <p className="text-gray-400 text-sm mb-4">{promo.description}</p>
              
              <div className="space-y-2 mb-4">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Time:</span>
                  <span className="text-white">{promo.startTime} - {promo.endTime}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Redemptions:</span>
                  <span className="text-red-400 font-bold">{promo.redemptions}</span>
                </div>
              </div>

              <button className={`w-full py-2 rounded-lg text-sm font-semibold transition-colors ${
                promo.active 
                  ? 'bg-red-600 hover:bg-red-700 text-white' 
                  : 'bg-gray-800 hover:bg-gray-700 text-gray-300'
              }`}>
                {promo.active ? 'Deactivate' : 'Activate'}
              </button>
            </div>
          ))}
        </div>
      </div>
    );

    const Photos = () => (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h2 className="text-2xl font-bold text-white">Venue Photos</h2>
          <button className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg flex items-center space-x-2 transition-colors">
            <Upload className="w-4 h-4" />
            <span>Upload Photo</span>
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {photos.map((photo) => (
            <div key={photo.id} className="relative group">
              <div className="aspect-square bg-gray-800 rounded-lg overflow-hidden">
                <div className="w-full h-full bg-gradient-to-br from-red-900/20 to-gray-800 flex items-center justify-center">
                  <Image className="w-12 h-12 text-red-400/50" />
                </div>
              </div>
              
              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center">
                <div className="text-center text-white">
                  <div className="flex items-center justify-center space-x-4 mb-2">
                    <div className="flex items-center space-x-1">
                      <Heart className="w-4 h-4 text-red-400" />
                      <span className="text-sm">{photo.likes}</span>
                    </div>
                    <div className="flex items-center space-x-1">
                      <Eye className="w-4 h-4 text-red-400" />
                      <span className="text-sm">{photo.views}</span>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button className="p-2 bg-red-500 hover:bg-red-600 rounded-lg transition-colors">
                      <Edit className="w-4 h-4" />
                    </button>
                    <button className="p-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>

              {photo.featured && (
                <div className="absolute top-2 left-2 bg-red-500 text-white px-2 py-1 rounded-full text-xs font-semibold">
                  Featured
                </div>
              )}
              
              <div className="absolute bottom-2 left-2 right-2 text-white text-xs bg-black/60 backdrop-blur-sm rounded px-2 py-1">
                {photo.uploaded}
              </div>
            </div>
          ))}
        </div>
      </div>
    );

    const PromoModal = () => (
      showPromoModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-red-900/30 rounded-lg p-6 w-full max-w-md mx-4">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold text-white">Create Promotion</h3>
              <button
                onClick={() => setShowPromoModal(false)}
                className="text-gray-400 hover:text-white"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-2">Title</label>
                <input
                  type="text"
                  value={newPromo.title}
                  onChange={(e) => setNewPromo({...newPromo, title: e.target.value})}
                  className="w-full px-3 py-2 bg-black border border-red-900/30 rounded-lg text-white focus:outline-none focus:border-red-500"
                  placeholder="Happy Hour Special"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-400 mb-2">Description</label>
                <textarea
                  value={newPromo.description}
                  onChange={(e) => setNewPromo({...newPromo, description: e.target.value})}
                  className="w-full px-3 py-2 bg-black border border-red-900/30 rounded-lg text-white focus:outline-none focus:border-red-500"
                  rows="3"
                  placeholder="25% off all drinks"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-2">Start Time</label>
                  <input
                    type="time"
                    value={newPromo.startTime}
                    onChange={(e) => setNewPromo({...newPromo, startTime: e.target.value})}
                    className="w-full px-3 py-2 bg-black border border-red-900/30 rounded-lg text-white focus:outline-none focus:border-red-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-2">End Time</label>
                  <input
                    type="time"
                    value={newPromo.endTime}
                    onChange={(e) => setNewPromo({...newPromo, endTime: e.target.value})}
                    className="w-full px-3 py-2 bg-black border border-red-900/30 rounded-lg text-white focus:outline-none focus:border-red-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-400 mb-2">Type</label>
                <select
                  value={newPromo.type}
                  onChange={(e) => setNewPromo({...newPromo, type: e.target.value})}
                  className="w-full px-3 py-2 bg-black border border-red-900/30 rounded-lg text-white focus:outline-none focus:border-red-500"
                >
                  <option value="discount">Discount</option>
                  <option value="free">Free Item</option>
                  <option value="bogo">Buy One Get One</option>
                </select>
              </div>
            </div>

            <div className="flex space-x-3 mt-6">
              <button
                onClick={() => setShowPromoModal(false)}
                className="flex-1 py-2 border border-gray-600 text-gray-400 rounded-lg hover:bg-gray-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowPromoModal(false);
                }}
                className="flex-1 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors"
              >
                Create Promo
              </button>
            </div>
          </div>
        </div>
      )
    );

    return (
      <div className="min-h-screen bg-black">
        <Header />
        <div className="flex h-screen">
          <Sidebar />
          <main className="flex-1 overflow-y-auto p-6">
            {activeTab === 'overview' && <Overview />}
            {activeTab === 'promos' && <Promotions />}
            {activeTab === 'photos' && <Photos />}
          </main>
        </div>
        <PromoModal />
      </div>
    );
  };

  // Main App Controller
  return (
    <div className="min-h-screen bg-black">
      {/* View Mode Toggle */}
      <div className="fixed top-4 right-4 z-50">
        <div className="bg-gray-900 border border-red-900/30 rounded-lg p-2 flex space-x-2">
          <button
            onClick={() => setViewMode('customer')}
            className={`px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${
              viewMode === 'customer'
                ? 'bg-red-500 text-white'
                : 'text-gray-400 hover:text-white hover:bg-gray-800'
            }`}
          >
            Customer App
          </button>
          <button
            onClick={() => setViewMode('venue')}
            className={`px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${
              viewMode === 'venue'
                ? 'bg-red-500 text-white'
                : 'text-gray-400 hover:text-white hover:bg-gray-800'
            }`}
          >
            Venue Dashboard
          </button>
        </div>
      </div>

      {/* Render Selected View */}
      {viewMode === 'customer' ? <SceneApp /> : <VenueDashboard />}
    </div>
  );
};

export default SceneAppComplete;