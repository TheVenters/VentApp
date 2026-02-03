// Supabase client configuration (local development)
let supabaseClient = null;
let currentUser = null;
let unreadCounts = {}; // { friendId: count }
let globalMessageSubscription = null;

try {
  const SUPABASE_URL = 'http://127.0.0.1:54321';
  const SUPABASE_ANON_KEY = 'KEY';
  if (window.supabase) {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    console.log('Supabase client initialized');
  } else {
    console.warn('Supabase library not loaded');
  }
} catch (e) {
  console.error('Failed to initialize Supabase:', e);
}

// Center: Denver-ish as a default
const map = L.map("map").setView([39.7392, -104.9903], 12);

// Map tile layers
const tileLayers = {
  standard: L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }),
  satellite: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 19,
    attribution: '&copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
  }),
  bike: L.tileLayer("https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png", {
    maxZoom: 20,
    attribution: '&copy; CyclOSM &copy; OpenStreetMap contributors',
  }),
  terrain: L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
    maxZoom: 17,
    attribution: '&copy; OpenTopoMap contributors',
  }),
  dark: L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
  }),
  transit: L.tileLayer("https://{s}.tile.thunderforest.com/transport/{z}/{x}/{y}.png?apikey=key", {
    maxZoom: 19,
    attribution: '&copy; Thunderforest &copy; OpenStreetMap contributors',
  })
};

let currentTileLayer = tileLayers.standard;
currentTileLayer.addTo(map);

// Example marker
// L.marker([39.7392, -104.9903]).addTo(map).bindPopup("Hello map!");

// Pin dropping functionality
let isPlacingPin = false;
let pendingPinType = null;
let allPins = []; // All pins on the map (from database)
let pinsSubscription = null; // Realtime subscription

// Load pins from database
async function loadPins() {
  if (!supabaseClient) return;
  
  try {
    const { data: pins, error } = await supabaseClient
      .from('pins')
      .select('*')
      .eq('layer', 'public')
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('Error loading pins:', error);
      return;
    }
    
    console.log(`Loaded ${pins.length} pins from database`);
    
    // Add each pin to the map
    pins.forEach(pin => {
      addPinToMap(pin);
    });
  } catch (e) {
    console.error('Failed to load pins:', e);
  }
}

// Subscribe to realtime pin updates
function subscribeToPins() {
  if (!supabaseClient) return;
  
  pinsSubscription = supabaseClient
    .channel('public-pins')
    .on('postgres_changes', 
      { event: 'INSERT', schema: 'public', table: 'pins', filter: 'layer=eq.public' },
      (payload) => {
        console.log('New pin received:', payload.new);
        // Only add if we don't already have it
        if (!allPins.find(p => p.id === payload.new.id)) {
          addPinToMap(payload.new);
        }
      }
    )
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'pins', filter: 'layer=eq.public' },
      (payload) => {
        console.log('Pin updated:', payload.new);
        const existingPin = allPins.find(p => p.id === payload.new.id);
        if (existingPin) {
          // Update pin data
          Object.assign(existingPin, payload.new);
          existingPin.latlng = { lat: payload.new.lat, lng: payload.new.lng };
          existingPin.author = payload.new.author_name;
          existingPin.username = payload.new.author_username;
          // Update popup
          const popupHtml = generatePopupHtml(existingPin.type, existingPin);
          existingPin.marker.setPopupContent(popupHtml);
        }
      }
    )
    .on('postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'pins', filter: 'layer=eq.public' },
      (payload) => {
        console.log('Pin deleted:', payload.old);
        const pinIndex = allPins.findIndex(p => p.id === payload.old.id);
        if (pinIndex !== -1) {
          const pin = allPins[pinIndex];
          map.removeLayer(pin.marker);
          allPins.splice(pinIndex, 1);
        }
      }
    )
    .subscribe();
  
  console.log('Subscribed to realtime pin updates');
}

// Add a pin from database to the map
function addPinToMap(dbPin) {
  const pinData = {
    id: dbPin.id,
    odid: dbPin.user_id,
    type: dbPin.type,
    content: dbPin.content,
    caption: dbPin.caption,
    mediaUrl: dbPin.media_url,
    mediaType: dbPin.media_type,
    latlng: { lat: dbPin.lat, lng: dbPin.lng },
    author: dbPin.author_name || 'Anonymous',
    username: dbPin.author_username || '',
    layer: dbPin.layer,
    createdAt: dbPin.created_at
  };
  
  // Determine icon type
  let iconType = pinData.type;
  if (pinData.type === 'media') {
    iconType = pinData.mediaType || 'photo';
  }
  
  const popupHtml = generatePopupHtml(pinData.type, pinData);
  
  const marker = L.marker([pinData.latlng.lat, pinData.latlng.lng], { 
    icon: pinIcons[iconType] || pinIcons.text 
  })
    .addTo(map)
    .bindPopup(popupHtml, { maxWidth: 320 });
  
  pinData.marker = marker;
  allPins.push(pinData);
}

// Initialize pins after page loads
setTimeout(() => {
  loadPins();
  subscribeToPins();
}, 500);

// Custom pin icons
const pinIcons = {
  photo: L.divIcon({
    className: 'custom-pin',
    html: '<div style="background: #34a853; width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 18px; box-shadow: 0 2px 8px rgba(0,0,0,0.3); border: 3px solid white;">📷</div>',
    iconSize: [36, 36],
    iconAnchor: [18, 18]
  }),
  text: L.divIcon({
    className: 'custom-pin',
    html: '<div style="background: #fbbc04; width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 18px; box-shadow: 0 2px 8px rgba(0,0,0,0.3); border: 3px solid white;">📝</div>',
    iconSize: [36, 36],
    iconAnchor: [18, 18]
  }),
  video: L.divIcon({
    className: 'custom-pin',
    html: '<div style="background: #ea4335; width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 18px; box-shadow: 0 2px 8px rgba(0,0,0,0.3); border: 3px solid white;">🎬</div>',
    iconSize: [36, 36],
    iconAnchor: [18, 18]
  }),
  media: L.divIcon({
    className: 'custom-pin',
    html: '<div style="background: linear-gradient(135deg, #34a853 0%, #ea4335 100%); width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 18px; box-shadow: 0 2px 8px rgba(0,0,0,0.3); border: 3px solid white;">📸</div>',
    iconSize: [36, 36],
    iconAnchor: [18, 18]
  })
};

function startPinPlacement(type) {
  if (!currentUser) {
    alert('Please sign in to create posts');
    openAccountPage();
    return;
  }
  isPlacingPin = true;
  pendingPinType = type;
  map.getContainer().style.cursor = 'crosshair';
  
  // Show placement hint
  const hint = document.createElement('div');
  hint.id = 'pinPlacementHint';
  hint.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(0,0,0,0.8); color: white; padding: 16px 24px; border-radius: 12px; font-family: -apple-system, sans-serif; font-size: 16px; z-index: 2000; pointer-events: none;';
  hint.textContent = `Click on the map to place your ${type} pin`;
  document.body.appendChild(hint);
  
  setTimeout(() => hint.remove(), 3000);
}

function cancelPinPlacement() {
  isPlacingPin = false;
  pendingPinType = null;
  map.getContainer().style.cursor = '';
  const hint = document.getElementById('pinPlacementHint');
  if (hint) hint.remove();
}

// Pin Modal elements
const pinModalOverlay = document.getElementById('pinModalOverlay');
const pinModalIcon = document.getElementById('pinModalIcon');
const pinModalTitleText = document.getElementById('pinModalTitleText');
const pinModalInput = document.getElementById('pinModalInput');
const pinModalMediaUrl = document.getElementById('pinModalMediaUrl');
const pinModalHint = document.getElementById('pinModalHint');
const pinModalClose = document.getElementById('pinModalClose');
const pinModalCancel = document.getElementById('pinModalCancel');
const pinModalSubmit = document.getElementById('pinModalSubmit');
const mediaTypeToggle = document.getElementById('mediaTypeToggle');
const mediaTypePhoto = document.getElementById('mediaTypePhoto');
const mediaTypeVideo = document.getElementById('mediaTypeVideo');
const mediaUrlGroup = document.getElementById('mediaUrlGroup');
const mediaUrlLabel = document.getElementById('mediaUrlLabel');
const textFieldLabel = document.getElementById('textFieldLabel');

let pendingPinLatLng = null;
let editingPinId = null;
let currentMediaType = 'photo'; // 'photo' or 'video'

// Media type toggle handlers
mediaTypePhoto.addEventListener('click', () => {
  currentMediaType = 'photo';
  mediaTypePhoto.classList.add('active');
  mediaTypeVideo.classList.remove('active');
  mediaUrlLabel.textContent = 'Photo URL';
  pinModalMediaUrl.placeholder = 'Paste image URL here...';
});

mediaTypeVideo.addEventListener('click', () => {
  currentMediaType = 'video';
  mediaTypeVideo.classList.add('active');
  mediaTypePhoto.classList.remove('active');
  mediaUrlLabel.textContent = 'Video URL';
  pinModalMediaUrl.placeholder = 'Paste YouTube URL here...';
});

function showPinModal(type, latlng, existingContent = '', pinId = null, existingMediaUrl = '') {
  pendingPinLatLng = latlng;
  pendingPinType = type;
  editingPinId = pinId;
  
  const isEditing = pinId !== null;
  
  // Reset fields
  pinModalInput.value = existingContent;
  pinModalMediaUrl.value = existingMediaUrl;
  
  // Configure modal based on type
  if (type === 'text') {
    pinModalIcon.textContent = '📝';
    pinModalTitleText.textContent = isEditing ? 'Edit Text' : 'Add Text';
    pinModalInput.placeholder = 'What\'s on your mind?';
    pinModalHint.textContent = 'Share your thoughts with the community';
    pinModalInput.rows = 4;
    pinModalSubmit.className = 'pin-modal-btn submit text';
    mediaTypeToggle.style.display = 'none';
    mediaUrlGroup.style.display = 'none';
    textFieldLabel.style.display = 'none';
  } else if (type === 'media') {
    pinModalIcon.textContent = '📸';
    pinModalTitleText.textContent = isEditing ? 'Edit Media' : 'Add Media';
    pinModalInput.placeholder = 'Add a caption (optional)...';
    pinModalHint.textContent = 'Share a photo or video with the community';
    pinModalInput.rows = 2;
    pinModalSubmit.className = 'pin-modal-btn submit media';
    mediaTypeToggle.style.display = 'flex';
    mediaUrlGroup.style.display = 'block';
    textFieldLabel.style.display = 'block';
    textFieldLabel.textContent = 'Caption (optional)';
    
    // Reset to photo by default, or use existing type
    if (existingMediaUrl && existingMediaUrl.includes('youtube')) {
      currentMediaType = 'video';
      mediaTypeVideo.classList.add('active');
      mediaTypePhoto.classList.remove('active');
      mediaUrlLabel.textContent = 'Video URL';
      pinModalMediaUrl.placeholder = 'Paste YouTube URL here...';
    } else {
      currentMediaType = 'photo';
      mediaTypePhoto.classList.add('active');
      mediaTypeVideo.classList.remove('active');
      mediaUrlLabel.textContent = 'Photo URL';
      pinModalMediaUrl.placeholder = 'Paste image URL here...';
    }
  } else if (type === 'photo') {
    // Legacy support for editing old photo pins
    pendingPinType = 'media';
    currentMediaType = 'photo';
    pinModalIcon.textContent = '📸';
    pinModalTitleText.textContent = 'Edit Photo';
    pinModalInput.placeholder = 'Add a caption (optional)...';
    pinModalHint.textContent = 'Share a photo with the community';
    pinModalInput.rows = 2;
    pinModalSubmit.className = 'pin-modal-btn submit media';
    mediaTypeToggle.style.display = 'flex';
    mediaUrlGroup.style.display = 'block';
    textFieldLabel.style.display = 'block';
    textFieldLabel.textContent = 'Caption (optional)';
    mediaTypePhoto.classList.add('active');
    mediaTypeVideo.classList.remove('active');
    mediaUrlLabel.textContent = 'Photo URL';
    pinModalMediaUrl.placeholder = 'Paste image URL here...';
  } else if (type === 'video') {
    // Legacy support for editing old video pins
    pendingPinType = 'media';
    currentMediaType = 'video';
    pinModalIcon.textContent = '📸';
    pinModalTitleText.textContent = 'Edit Video';
    pinModalInput.placeholder = 'Add a caption (optional)...';
    pinModalHint.textContent = 'Share a video with the community';
    pinModalInput.rows = 2;
    pinModalSubmit.className = 'pin-modal-btn submit media';
    mediaTypeToggle.style.display = 'flex';
    mediaUrlGroup.style.display = 'block';
    textFieldLabel.style.display = 'block';
    textFieldLabel.textContent = 'Caption (optional)';
    mediaTypeVideo.classList.add('active');
    mediaTypePhoto.classList.remove('active');
    mediaUrlLabel.textContent = 'Video URL';
    pinModalMediaUrl.placeholder = 'Paste YouTube URL here...';
  }
  
  pinModalSubmit.textContent = isEditing ? 'Update' : 'Post';
  pinModalOverlay.classList.add('active');
  
  // Focus appropriate field
  setTimeout(() => {
    if (type === 'media' || type === 'photo' || type === 'video') {
      pinModalMediaUrl.focus();
    } else {
      pinModalInput.focus();
    }
  }, 300);
}

function closePinModal() {
  pinModalOverlay.classList.remove('active');
  pendingPinLatLng = null;
  editingPinId = null;
  pinModalMediaUrl.value = '';
  cancelPinPlacement();
}

function submitPinContent() {
  const caption = pinModalInput.value.trim();
  const mediaUrl = pinModalMediaUrl.value.trim();
  
  if (pendingPinType === 'text') {
    if (!caption) return;
    if (editingPinId !== null) {
      updatePin(editingPinId, caption, '');
    } else {
      createPin('text', pendingPinLatLng, caption, '');
    }
  } else if (pendingPinType === 'media') {
    if (!mediaUrl) return;
    if (editingPinId !== null) {
      updatePin(editingPinId, caption, mediaUrl, currentMediaType);
    } else {
      createPin('media', pendingPinLatLng, caption, mediaUrl, currentMediaType);
    }
  }
  closePinModal();
}

function editPin(pinId) {
  const pin = allPins.find(p => p.id === pinId);
  if (!pin) return;
  
  // Check ownership
  if (!currentUser || pin.odid !== currentUser.id) {
    console.warn('Cannot edit: not the owner');
    return;
  }
  
  // Close the current popup
  pin.marker.closePopup();
  
  // Open modal with existing content
  showPinModal(pin.type, pin.latlng, pin.caption || pin.content, pinId, pin.mediaUrl || (pin.type !== 'text' ? pin.content : ''));
}

async function updatePin(pinId, caption, mediaUrl = '', mediaType = 'photo') {
  const pin = allPins.find(p => p.id === pinId);
  if (!pin) return;
  
  // Check ownership
  if (!currentUser || pin.odid !== currentUser.id) {
    console.warn('Cannot update: not the owner');
    return;
  }
  
  // Prepare update data
  const updateData = {
    caption: caption || null,
    updated_at: new Date().toISOString()
  };
  
  if (pin.type === 'text') {
    updateData.content = caption;
  } else {
    updateData.media_url = mediaUrl;
    updateData.media_type = mediaType;
    updateData.content = mediaUrl;
  }
  
  try {
    const { error } = await supabaseClient
      .from('pins')
      .update(updateData)
      .eq('id', pinId);
    
    if (error) {
      console.error('Error updating pin:', error);
      alert('Failed to update pin. Please try again.');
      return;
    }
    
    // Update local pin data
    if (pin.type === 'text') {
      pin.content = caption;
      pin.caption = caption;
    } else {
      pin.caption = caption;
      pin.mediaUrl = mediaUrl;
      pin.mediaType = mediaType;
      pin.content = mediaUrl;
    }
    
    // Regenerate popup HTML
    const popupHtml = generatePopupHtml(pin.type, pin);
    
    // Update the marker's popup
    pin.marker.setPopupContent(popupHtml);
    pin.marker.openPopup();
    
    console.log(`Updated pin ${pinId}`);
  } catch (e) {
    console.error('Failed to update pin:', e);
    alert('Failed to update pin. Please try again.');
  }
}

async function deletePin(pinId) {
  const pinIndex = allPins.findIndex(p => p.id === pinId);
  if (pinIndex === -1) return;
  
  const pin = allPins[pinIndex];
  
  // Check ownership
  if (!currentUser || pin.odid !== currentUser.id) {
    console.warn('Cannot delete: not the owner');
    return;
  }
  
  try {
    const { error } = await supabaseClient
      .from('pins')
      .delete()
      .eq('id', pinId);
    
    if (error) {
      console.error('Error deleting pin:', error);
      alert('Failed to delete pin. Please try again.');
      return;
    }
    
    // Remove marker from map
    map.removeLayer(pin.marker);
    
    // Remove from array
    allPins.splice(pinIndex, 1);
    
    console.log(`Deleted pin ${pinId}`);
  } catch (e) {
    console.error('Failed to delete pin:', e);
    alert('Failed to delete pin. Please try again.');
  }
}

// Make functions global for popup buttons
window.editPin = editPin;
window.deletePin = deletePin;

pinModalClose.addEventListener('click', closePinModal);
pinModalCancel.addEventListener('click', closePinModal);
pinModalSubmit.addEventListener('click', submitPinContent);
pinModalOverlay.addEventListener('click', (e) => {
  if (e.target === pinModalOverlay) closePinModal();
});
pinModalInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && pendingPinType === 'text') {
    e.preventDefault();
    submitPinContent();
  }
});

function generatePopupHtml(type, pinData) {
  // Only show edit/delete buttons for the pin owner
  const isOwner = currentUser && pinData.odid === currentUser.id;
  const actionButtons = isOwner ? `
    <div class="pin-actions">
      <button class="pin-action-btn edit" onclick="editPin('${pinData.id}')">✏️ Edit</button>
      <button class="pin-action-btn delete" onclick="deletePin('${pinData.id}')">🗑️ Delete</button>
    </div>
  ` : '';
  
  const captionHtml = pinData.caption ? `<div style="font-size: 14px; color: #333; margin-top: 8px;">${pinData.caption}</div>` : '';
  
  if (type === 'text') {
    return `
      <div style="min-width: 200px; font-family: -apple-system, sans-serif;">
        <div style="font-weight: 600; margin-bottom: 8px;">${pinData.author} ${pinData.username ? '@' + pinData.username : ''}</div>
        <div style="font-size: 14px; color: #333;">${pinData.content}</div>
        ${actionButtons}
      </div>
    `;
  } else if (type === 'media' || type === 'photo' || type === 'video') {
    const mediaUrl = pinData.mediaUrl || pinData.content;
    const mediaType = pinData.mediaType || (type === 'video' ? 'video' : 'photo');
    
    if (mediaType === 'video') {
      let embedUrl = mediaUrl;
      if (mediaUrl.includes('youtube.com/watch')) {
        const videoId = mediaUrl.split('v=')[1]?.split('&')[0];
        embedUrl = `https://www.youtube.com/embed/${videoId}`;
      } else if (mediaUrl.includes('youtu.be/')) {
        const videoId = mediaUrl.split('youtu.be/')[1]?.split('?')[0];
        embedUrl = `https://www.youtube.com/embed/${videoId}`;
      }
      return `
        <div style="min-width: 280px; font-family: -apple-system, sans-serif;">
          <div style="font-weight: 600; margin-bottom: 8px;">${pinData.author} ${pinData.username ? '@' + pinData.username : ''}</div>
          <iframe width="280" height="158" src="${embedUrl}" frameborder="0" allowfullscreen style="border-radius: 8px;"></iframe>
          ${captionHtml}
          ${actionButtons}
        </div>
      `;
    } else {
      return `
        <div style="min-width: 200px; font-family: -apple-system, sans-serif;">
          <div style="font-weight: 600; margin-bottom: 8px;">${pinData.author} ${pinData.username ? '@' + pinData.username : ''}</div>
          <img src="${mediaUrl}" style="max-width: 250px; max-height: 200px; border-radius: 8px;" onerror="this.src='https://via.placeholder.com/250x150?text=Image+not+found'">
          ${captionHtml}
          ${actionButtons}
        </div>
      `;
    }
  }
  return '';
}

async function createPin(type, latlng, caption, mediaUrl = '', mediaType = 'photo') {
  if (!supabaseClient || !currentUser) {
    console.error('Cannot create pin: not authenticated');
    return;
  }
  
  // Get the selected layer
  const layer = document.getElementById('layerSelect')?.value || 'public';
  
  // Prepare database record
  const dbPin = {
    user_id: currentUser.id,
    type: type,
    content: type === 'text' ? caption : mediaUrl,
    caption: caption || null,
    media_url: type === 'media' ? mediaUrl : null,
    media_type: type === 'media' ? mediaType : null,
    lat: latlng.lat,
    lng: latlng.lng,
    layer: layer,
    author_name: currentUser.user_metadata?.name || 'Anonymous',
    author_username: currentUser.user_metadata?.username || ''
  };
  
  try {
    const { data, error } = await supabaseClient
      .from('pins')
      .insert(dbPin)
      .select()
      .single();
    
    if (error) {
      console.error('Error saving pin:', error);
      alert('Failed to save pin. Please try again.');
      return;
    }
    
    console.log('Pin saved to database:', data);
    
    // The realtime subscription will add it to the map
    // But we add it immediately for better UX
    addPinToMap(data);
    
    // Open the popup
    const newPin = allPins.find(p => p.id === data.id);
    if (newPin?.marker) {
      newPin.marker.openPopup();
    }
  } catch (e) {
    console.error('Failed to create pin:', e);
    alert('Failed to save pin. Please try again.');
  }
}

map.on('click', function(e) {
  if (!isPlacingPin || !pendingPinType) return;
  
  const type = pendingPinType;
  const latlng = e.latlng;
  
  // Show custom modal instead of prompt
  showPinModal(type, latlng);
  map.getContainer().style.cursor = '';
  const hint = document.getElementById('pinPlacementHint');
  if (hint) hint.remove();
  isPlacingPin = false;
});

// Cancel pin placement on Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && isPlacingPin) {
    cancelPinPlacement();
  }
});

// FAB Button functionality
const fabButton = document.getElementById('fabButton');
const fabMenu = document.getElementById('fabMenu');
const fabOverlay = document.getElementById('fabOverlay');
const fabOptions = document.querySelectorAll('.fab-option');
const layerSelect = document.getElementById('layerSelect');

function toggleFab() {
  fabButton.classList.toggle('active');
  fabMenu.classList.toggle('active');
  fabOverlay.classList.toggle('active');
}

function closeFab() {
  fabButton.classList.remove('active');
  fabMenu.classList.remove('active');
  fabOverlay.classList.remove('active');
}

fabButton.addEventListener('click', toggleFab);
fabOverlay.addEventListener('click', closeFab);

fabOptions.forEach(option => {
  option.addEventListener('click', () => {
    const type = option.dataset.type;
    closeFab();
    startPinPlacement(type);
  });
});

// Hamburger Menu functionality
const hamburgerButton = document.getElementById('hamburgerButton');
const hamburgerMenu = document.getElementById('hamburgerMenu');
const hamburgerOverlay = document.getElementById('hamburgerOverlay');
const hamburgerMenuItems = document.querySelectorAll('.hamburger-menu-item');

function toggleHamburger() {
  hamburgerButton.classList.toggle('active');
  hamburgerMenu.classList.toggle('active');
  hamburgerOverlay.classList.toggle('active');
}

function closeHamburger() {
  hamburgerButton.classList.remove('active');
  hamburgerMenu.classList.remove('active');
  hamburgerOverlay.classList.remove('active');
}

hamburgerButton.addEventListener('click', toggleHamburger);
hamburgerOverlay.addEventListener('click', closeHamburger);

hamburgerMenuItems.forEach(item => {
  item.addEventListener('click', () => {
    const action = item.dataset.action;
    closeHamburger();
    
    if (action === 'views') {
      openViewsSubmenu();
    } else if (action === 'account') {
      openAccountPage();
    } else if (action === 'friends') {
      openFriendsPage();
    } else {
      console.log(`Navigating to: ${action}`);
      // TODO: Handle other navigation
    }
  });
});

// Account Page functionality
const accountOverlay = document.getElementById('accountOverlay');
const accountCloseBtn = document.getElementById('accountCloseBtn');
const accountForm = document.getElementById('accountForm');

function openAccountPage() {
  accountOverlay.classList.add('active');
}

function closeAccountPage() {
  accountOverlay.classList.remove('active');
}

accountCloseBtn.addEventListener('click', closeAccountPage);

const accountEmail = document.getElementById('accountEmail');
const accountPassword = document.getElementById('accountPassword');
const accountMessage = document.getElementById('accountMessage');
const accountSubmitBtn = document.getElementById('accountSubmitBtn');
const accountLoggedIn = document.getElementById('accountLoggedIn');
const accountUserEmail = document.getElementById('accountUserEmail');
const accountLogoutBtn = document.getElementById('accountLogoutBtn');

function showAccountMessage(message, isError = false) {
  accountMessage.textContent = message;
  accountMessage.style.color = isError ? '#dc3545' : '#28a745';
}

function updateAuthUI(user) {
  currentUser = user;
  if (user) {
    accountForm.style.display = 'none';
    accountLoggedIn.style.display = 'block';
    accountUserEmail.textContent = user.email;
    
    // Display name and username from user_metadata
    const meta = user.user_metadata || {};
    document.getElementById('accountUserName').textContent = meta.name || 'User';
    document.getElementById('accountUsername').textContent = meta.username ? '@' + meta.username : '';
    
    document.querySelector('.account-divider').style.display = 'none';
    document.querySelector('.account-social').style.display = 'none';
    document.querySelector('.account-footer').style.display = 'none';
    
    // Start tracking unread messages
    loadUnreadCounts();
    subscribeToGlobalMessages();
  } else {
    accountForm.style.display = 'flex';
    accountLoggedIn.style.display = 'none';
    document.querySelector('.account-divider').style.display = 'flex';
    document.querySelector('.account-social').style.display = 'flex';
    document.querySelector('.account-footer').style.display = 'block';
    
    // Clear unread tracking
    unreadCounts = {};
    updateNotificationBadges();
    if (globalMessageSubscription) {
      globalMessageSubscription.unsubscribe();
      globalMessageSubscription = null;
    }
  }
}

// Check initial auth state
if (supabaseClient) {
  supabaseClient.auth.getSession().then(({ data: { session } }) => {
    updateAuthUI(session?.user || null);
  });
  
  // Listen for auth changes
  supabaseClient.auth.onAuthStateChange((event, session) => {
    updateAuthUI(session?.user || null);
  });
}

accountForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  if (!supabaseClient) {
    showAccountMessage('Auth service not available', true);
    return;
  }
  
  const email = accountEmail.value.trim();
  const password = accountPassword.value;
  
  accountSubmitBtn.disabled = true;
  accountSubmitBtn.textContent = 'Signing in...';
  showAccountMessage('');
  
  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email,
      password
    });
    
    if (error) {
      showAccountMessage(error.message, true);
    } else {
      showAccountMessage('Signed in successfully!');
      setTimeout(closeAccountPage, 1000);
    }
  } catch (err) {
    showAccountMessage('An error occurred. Please try again.', true);
  } finally {
    accountSubmitBtn.disabled = false;
    accountSubmitBtn.textContent = 'Sign In';
  }
});

accountLogoutBtn.addEventListener('click', async () => {
  if (!supabaseClient) return;
  
  accountLogoutBtn.disabled = true;
  accountLogoutBtn.textContent = 'Signing out...';
  
  await supabaseClient.auth.signOut();
  
  accountLogoutBtn.disabled = false;
  accountLogoutBtn.textContent = 'Sign Out';
  accountEmail.value = '';
  accountPassword.value = '';
  showAccountMessage('');
});

// Friends Page functionality
const friendsOverlay = document.getElementById('friendsOverlay');
const friendsCloseBtn = document.getElementById('friendsCloseBtn');
const friendsLoginPrompt = document.getElementById('friendsLoginPrompt');
const friendsLoggedInContent = document.getElementById('friendsLoggedInContent');
const friendsLoginBtn = document.getElementById('friendsLoginBtn');
const friendsSearchInput = document.getElementById('friendsSearchInput');
const friendsSearchBtn = document.getElementById('friendsSearchBtn');
const friendsSearchResults = document.getElementById('friendsSearchResults');
const friendsSearchResultsList = document.getElementById('friendsSearchResultsList');
const friendsTabs = document.querySelectorAll('.friends-tab');
const friendsSections = document.querySelectorAll('.friends-section');
const requestsBadge = document.getElementById('requestsBadge');

let friendsList = [];
let pendingRequests = [];
let sentRequests = [];

function openFriendsPage() {
  friendsOverlay.classList.add('active');
  updateFriendsUI();
  if (currentUser) {
    loadFriendsData();
  }
}

function closeFriendsPage() {
  friendsOverlay.classList.remove('active');
  friendsSearchResults.style.display = 'none';
  friendsSearchInput.value = '';
}

friendsCloseBtn.addEventListener('click', closeFriendsPage);

friendsLoginBtn.addEventListener('click', () => {
  closeFriendsPage();
  openAccountPage();
});

function updateFriendsUI() {
  if (currentUser) {
    friendsLoginPrompt.style.display = 'none';
    friendsLoggedInContent.style.display = 'block';
  } else {
    friendsLoginPrompt.style.display = 'block';
    friendsLoggedInContent.style.display = 'none';
  }
}

// Tab switching
friendsTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const tabName = tab.dataset.tab;
    friendsTabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    
    friendsSections.forEach(section => {
      section.classList.remove('active');
      if (section.id === tabName + 'ListSection') {
        section.classList.add('active');
      }
    });
  });
});

// Search users
async function searchUsers(query) {
  if (!supabaseClient || !query.trim()) return;
  
  try {
    const { data: users, error } = await supabaseClient
      .from('user_profiles')
      .select('*')
      .or(`username.ilike.%${query}%,name.ilike.%${query}%`)
      .neq('id', currentUser.id)
      .limit(10);
    
    if (error) {
      console.error('Error searching users:', error);
      return;
    }
    
    displaySearchResults(users);
  } catch (e) {
    console.error('Failed to search users:', e);
  }
}

function displaySearchResults(users) {
  friendsSearchResults.style.display = 'block';
  
  if (users.length === 0) {
    friendsSearchResultsList.innerHTML = '<div class="friends-empty" style="padding: 20px;"><div>No users found</div></div>';
    return;
  }
  
  friendsSearchResultsList.innerHTML = users.map(user => {
    // Check relationship status
    const isFriend = friendsList.some(f => f.friend_id === user.id || f.user_id === user.id);
    const hasSentRequest = sentRequests.some(r => r.to_user_id === user.id);
    const hasReceivedRequest = pendingRequests.some(r => r.from_user_id === user.id);
    
    let actionBtn = '';
    if (isFriend) {
      actionBtn = '<button class="friend-action-btn pending">✓ Friends</button>';
    } else if (hasSentRequest) {
      actionBtn = '<button class="friend-action-btn pending">Pending</button>';
    } else if (hasReceivedRequest) {
      actionBtn = `<button class="friend-action-btn accept" onclick="acceptRequest('${user.id}')">Accept</button>`;
    } else {
      actionBtn = `<button class="friend-action-btn add" onclick="sendFriendRequest('${user.id}')">Add Friend</button>`;
    }
    
    return `
      <div class="friend-item">
        <div class="friend-avatar">${(user.name || user.username || '?')[0].toUpperCase()}</div>
        <div class="friend-info">
          <div class="friend-name">${user.name || 'User'}</div>
          <div class="friend-username">@${user.username || 'unknown'}</div>
        </div>
        <div class="friend-actions">${actionBtn}</div>
      </div>
    `;
  }).join('');
}

friendsSearchBtn.addEventListener('click', () => {
  searchUsers(friendsSearchInput.value);
});

friendsSearchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    searchUsers(friendsSearchInput.value);
  }
});

// Load friends data
async function loadFriendsData() {
  if (!supabaseClient || !currentUser) return;
  
  try {
    // Load friends
    const { data: friends, error: friendsError } = await supabaseClient
      .from('friends')
      .select('*')
      .or(`user_id.eq.${currentUser.id},friend_id.eq.${currentUser.id}`);
    
    if (!friendsError) {
      friendsList = friends || [];
      renderFriendsList();
    }
    
    // Load pending requests (received)
    const { data: requests, error: requestsError } = await supabaseClient
      .from('friend_requests')
      .select('*')
      .eq('to_user_id', currentUser.id)
      .eq('status', 'pending');
    
    if (!requestsError) {
      pendingRequests = requests || [];
      renderRequestsList();
      updateRequestsBadge();
    }
    
    // Load sent requests
    const { data: sent, error: sentError } = await supabaseClient
      .from('friend_requests')
      .select('*')
      .eq('from_user_id', currentUser.id)
      .eq('status', 'pending');
    
    if (!sentError) {
      sentRequests = sent || [];
      renderSentList();
    }
  } catch (e) {
    console.error('Failed to load friends data:', e);
  }
}

async function renderFriendsList() {
  const container = document.getElementById('friendsList');
  const emptyState = document.getElementById('friendsEmptyState');
  
  if (friendsList.length === 0) {
    container.innerHTML = '';
    emptyState.style.display = 'block';
    return;
  }
  
  emptyState.style.display = 'none';
  
  // Get friend user details
  const friendIds = friendsList.map(f => f.user_id === currentUser.id ? f.friend_id : f.user_id);
  const { data: friendUsers } = await supabaseClient
    .from('user_profiles')
    .select('*')
    .in('id', friendIds);
  
  container.innerHTML = (friendUsers || []).map(user => {
    const unreadCount = unreadCounts[user.id] || 0;
    const badgeClass = unreadCount > 0 ? '' : 'hidden';
    return `
    <div class="friend-item">
      <div class="friend-avatar">${(user.name || user.username || '?')[0].toUpperCase()}</div>
      <div class="friend-info">
        <div class="friend-name">${user.name || 'User'}</div>
        <div class="friend-username">@${user.username || 'unknown'}</div>
      </div>
      <div class="friend-actions">
        <button class="friend-action-btn message" onclick="openChat('${user.id}', '${(user.name || 'User').replace(/'/g, "\\'")}', '@${user.username || 'unknown'}')">💬<span class="friend-message-badge ${badgeClass}" data-friend-id="${user.id}">${unreadCount}</span></button>
        <button class="friend-action-btn remove" onclick="removeFriend('${user.id}')">Remove</button>
      </div>
    </div>
  `;
  }).join('');
}

async function renderRequestsList() {
  const container = document.getElementById('requestsList');
  const emptyState = document.getElementById('requestsEmptyState');
  
  if (pendingRequests.length === 0) {
    container.innerHTML = '';
    emptyState.style.display = 'block';
    return;
  }
  
  emptyState.style.display = 'none';
  
  // Get requester user details
  const requesterIds = pendingRequests.map(r => r.from_user_id);
  const { data: requestUsers } = await supabaseClient
    .from('user_profiles')
    .select('*')
    .in('id', requesterIds);
  
  container.innerHTML = (requestUsers || []).map(user => `
    <div class="friend-item">
      <div class="friend-avatar">${(user.name || user.username || '?')[0].toUpperCase()}</div>
      <div class="friend-info">
        <div class="friend-name">${user.name || 'User'}</div>
        <div class="friend-username">@${user.username || 'unknown'}</div>
      </div>
      <div class="friend-actions">
        <button class="friend-action-btn accept" onclick="acceptRequest('${user.id}')">Accept</button>
        <button class="friend-action-btn reject" onclick="rejectRequest('${user.id}')">Decline</button>
      </div>
    </div>
  `).join('');
}

async function renderSentList() {
  const container = document.getElementById('sentList');
  const emptyState = document.getElementById('sentEmptyState');
  
  if (sentRequests.length === 0) {
    container.innerHTML = '';
    emptyState.style.display = 'block';
    return;
  }
  
  emptyState.style.display = 'none';
  
  // Get recipient user details
  const recipientIds = sentRequests.map(r => r.to_user_id);
  const { data: sentUsers } = await supabaseClient
    .from('user_profiles')
    .select('*')
    .in('id', recipientIds);
  
  container.innerHTML = (sentUsers || []).map(user => `
    <div class="friend-item">
      <div class="friend-avatar">${(user.name || user.username || '?')[0].toUpperCase()}</div>
      <div class="friend-info">
        <div class="friend-name">${user.name || 'User'}</div>
        <div class="friend-username">@${user.username || 'unknown'}</div>
      </div>
      <div class="friend-actions">
        <button class="friend-action-btn reject" onclick="cancelRequest('${user.id}')">Cancel</button>
      </div>
    </div>
  `).join('');
}

function updateRequestsBadge() {
  if (pendingRequests.length > 0) {
    requestsBadge.textContent = pendingRequests.length;
    requestsBadge.style.display = 'flex';
  } else {
    requestsBadge.style.display = 'none';
  }
}

// Friend actions
async function sendFriendRequest(toUserId) {
  if (!supabaseClient || !currentUser) return;
  
  try {
    const { error } = await supabaseClient
      .from('friend_requests')
      .insert({
        from_user_id: currentUser.id,
        to_user_id: toUserId
      });
    
    if (error) {
      console.error('Error sending friend request:', error);
      alert('Failed to send friend request');
      return;
    }
    
    await loadFriendsData();
    searchUsers(friendsSearchInput.value); // Refresh search results
  } catch (e) {
    console.error('Failed to send friend request:', e);
  }
}

async function acceptRequest(fromUserId) {
  if (!supabaseClient || !currentUser) return;
  
  try {
    // Update request status
    await supabaseClient
      .from('friend_requests')
      .update({ status: 'accepted', updated_at: new Date().toISOString() })
      .eq('from_user_id', fromUserId)
      .eq('to_user_id', currentUser.id);
    
    // Create friend entries (both directions)
    await supabaseClient.from('friends').insert([
      { user_id: currentUser.id, friend_id: fromUserId },
      { user_id: fromUserId, friend_id: currentUser.id }
    ]);
    
    await loadFriendsData();
  } catch (e) {
    console.error('Failed to accept friend request:', e);
  }
}

async function rejectRequest(fromUserId) {
  if (!supabaseClient || !currentUser) return;
  
  try {
    await supabaseClient
      .from('friend_requests')
      .update({ status: 'rejected', updated_at: new Date().toISOString() })
      .eq('from_user_id', fromUserId)
      .eq('to_user_id', currentUser.id);
    
    await loadFriendsData();
  } catch (e) {
    console.error('Failed to reject friend request:', e);
  }
}

async function cancelRequest(toUserId) {
  if (!supabaseClient || !currentUser) return;
  
  try {
    await supabaseClient
      .from('friend_requests')
      .delete()
      .eq('from_user_id', currentUser.id)
      .eq('to_user_id', toUserId);
    
    await loadFriendsData();
  } catch (e) {
    console.error('Failed to cancel friend request:', e);
  }
}

async function removeFriend(friendId) {
  if (!supabaseClient || !currentUser) return;
  
  if (!confirm('Remove this friend?')) return;
  
  try {
    // Remove both friend entries
    await supabaseClient
      .from('friends')
      .delete()
      .or(`and(user_id.eq.${currentUser.id},friend_id.eq.${friendId}),and(user_id.eq.${friendId},friend_id.eq.${currentUser.id})`);
    
    await loadFriendsData();
  } catch (e) {
    console.error('Failed to remove friend:', e);
  }
}

// Make functions global for onclick handlers
window.sendFriendRequest = sendFriendRequest;
window.acceptRequest = acceptRequest;
window.rejectRequest = rejectRequest;
window.cancelRequest = cancelRequest;
window.removeFriend = removeFriend;

// Chat functionality
const chatOverlay = document.getElementById('chatOverlay');
const chatBackBtn = document.getElementById('chatBackBtn');
const chatUserName = document.getElementById('chatUserName');
const chatUserStatus = document.getElementById('chatUserStatus');
const chatMessages = document.getElementById('chatMessages');
const chatEmpty = document.getElementById('chatEmpty');
const chatInput = document.getElementById('chatInput');
const chatSendBtn = document.getElementById('chatSendBtn');

let currentChatUserId = null;
let currentChatUserName = '';
let chatSubscription = null;

function openChat(userId, userName, userUsername) {
  currentChatUserId = userId;
  currentChatUserName = userName;
  chatUserName.textContent = userName;
  chatUserStatus.textContent = userUsername;
  chatOverlay.classList.add('active');
  chatInput.value = '';
  loadMessages();
  subscribeToChatMessages();
}

function closeChat() {
  chatOverlay.classList.remove('active');
  currentChatUserId = null;
  if (chatSubscription) {
    chatSubscription.unsubscribe();
    chatSubscription = null;
  }
}

chatBackBtn.addEventListener('click', closeChat);
chatOverlay.addEventListener('click', (e) => {
  if (e.target === chatOverlay) closeChat();
});

async function loadMessages() {
  if (!supabaseClient || !currentUser || !currentChatUserId) return;
  
  try {
    const { data: messages, error } = await supabaseClient
      .from('messages')
      .select('*')
      .or(`and(from_user_id.eq.${currentUser.id},to_user_id.eq.${currentChatUserId}),and(from_user_id.eq.${currentChatUserId},to_user_id.eq.${currentUser.id})`)
      .order('created_at', { ascending: true });
    
    if (error) {
      console.error('Error loading messages:', error);
      return;
    }
    
    renderMessages(messages || []);
    
    // Mark received messages as read
    const unreadIds = (messages || [])
      .filter(m => m.to_user_id === currentUser.id && !m.read_at)
      .map(m => m.id);
    
    if (unreadIds.length > 0) {
      await supabaseClient
        .from('messages')
        .update({ read_at: new Date().toISOString() })
        .in('id', unreadIds);
      
      // Update unread counts and badges
      loadUnreadCounts();
    }
  } catch (e) {
    console.error('Failed to load messages:', e);
  }
}

function renderMessages(messages) {
  if (messages.length === 0) {
    chatEmpty.style.display = 'flex';
    chatMessages.innerHTML = '';
    chatMessages.appendChild(chatEmpty);
    return;
  }
  
  chatEmpty.style.display = 'none';
  chatMessages.innerHTML = messages.map(msg => {
    const isSent = msg.from_user_id === currentUser.id;
    const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `
      <div class="chat-message ${isSent ? 'sent' : 'received'}">
        <div>${escapeHtml(msg.content)}</div>
        <div class="chat-message-time">${time}</div>
      </div>
    `;
  }).join('');
  
  // Scroll to bottom
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function subscribeToChatMessages() {
  if (!supabaseClient || !currentUser || !currentChatUserId) return;
  
  // Unsubscribe from previous if exists
  if (chatSubscription) {
    chatSubscription.unsubscribe();
  }
  
  chatSubscription = supabaseClient
    .channel(`chat-${currentUser.id}-${currentChatUserId}`)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'messages' },
      (payload) => {
        const msg = payload.new || payload.old;
        if (!msg) return;
        
        // Only handle if it's part of this conversation
        if ((msg.from_user_id === currentUser.id && msg.to_user_id === currentChatUserId) ||
            (msg.from_user_id === currentChatUserId && msg.to_user_id === currentUser.id)) {
          // Reload messages to ensure proper ordering
          loadMessages();
        }
      }
    )
    .subscribe((status) => {
      console.log('Chat subscription status:', status);
    });
}

async function sendMessage() {
  const content = chatInput.value.trim();
  if (!content || !supabaseClient || !currentUser || !currentChatUserId) return;
  
  chatSendBtn.disabled = true;
  
  try {
    const { error } = await supabaseClient
      .from('messages')
      .insert({
        from_user_id: currentUser.id,
        to_user_id: currentChatUserId,
        content: content
      });
    
    if (error) {
      console.error('Error sending message:', error);
      return;
    }
    
    chatInput.value = '';
    // Message will appear via realtime subscription
    loadMessages();
  } catch (e) {
    console.error('Failed to send message:', e);
  } finally {
    chatSendBtn.disabled = false;
  }
}

chatSendBtn.addEventListener('click', sendMessage);
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Unread message count functions
async function loadUnreadCounts() {
  if (!supabaseClient || !currentUser) return;
  
  try {
    const { data: unread, error } = await supabaseClient
      .from('messages')
      .select('from_user_id')
      .eq('to_user_id', currentUser.id)
      .is('read_at', null);
    
    if (error) {
      console.error('Error loading unread counts:', error);
      return;
    }
    
    // Count messages per sender
    unreadCounts = {};
    (unread || []).forEach(msg => {
      unreadCounts[msg.from_user_id] = (unreadCounts[msg.from_user_id] || 0) + 1;
    });
    
    updateNotificationBadges();
  } catch (e) {
    console.error('Failed to load unread counts:', e);
  }
}

function updateNotificationBadges() {
  const hamburgerBadge = document.getElementById('hamburgerBadge');
  const friendsBadge = document.getElementById('friendsBadge');
  
  // Calculate total unread
  const totalUnread = Object.values(unreadCounts).reduce((sum, count) => sum + count, 0);
  
  // Update hamburger badge
  if (totalUnread > 0) {
    hamburgerBadge.textContent = totalUnread > 99 ? '99+' : totalUnread;
    hamburgerBadge.classList.remove('hidden');
  } else {
    hamburgerBadge.classList.add('hidden');
  }
  
  // Update friends menu badge
  if (totalUnread > 0) {
    friendsBadge.textContent = totalUnread > 99 ? '99+' : totalUnread;
    friendsBadge.classList.remove('hidden');
  } else {
    friendsBadge.classList.add('hidden');
  }
  
  // Update per-friend badges in the list
  document.querySelectorAll('.friend-message-badge').forEach(badge => {
    const friendId = badge.dataset.friendId;
    const count = unreadCounts[friendId] || 0;
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : count;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  });
}

function subscribeToGlobalMessages() {
  if (!supabaseClient || !currentUser) return;
  
  if (globalMessageSubscription) {
    globalMessageSubscription.unsubscribe();
  }
  
  globalMessageSubscription = supabaseClient
    .channel('global-messages-' + currentUser.id)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'messages' },
      (payload) => {
        // Reload unread counts when any message changes
        loadUnreadCounts();
      }
    )
    .subscribe((status) => {
      console.log('Global message subscription status:', status);
    });
}

window.openChat = openChat;

// Views Submenu functionality
const viewsSubmenu = document.getElementById('viewsSubmenu');
const viewsOverlay = document.getElementById('viewsOverlay');
const viewsCloseBtn = document.getElementById('viewsCloseBtn');
const viewOptions = document.querySelectorAll('.view-option');

function openViewsSubmenu() {
  viewsSubmenu.classList.add('active');
  viewsOverlay.classList.add('active');
}

function closeViewsSubmenu() {
  viewsSubmenu.classList.remove('active');
  viewsOverlay.classList.remove('active');
}

viewsCloseBtn.addEventListener('click', closeViewsSubmenu);
viewsOverlay.addEventListener('click', closeViewsSubmenu);

viewOptions.forEach(option => {
  option.addEventListener('click', () => {
    const viewType = option.dataset.view;
    
    // Remove active class from all options
    viewOptions.forEach(opt => opt.classList.remove('active'));
    option.classList.add('active');
    
    // Switch tile layer
    map.removeLayer(currentTileLayer);
    currentTileLayer = tileLayers[viewType];
    currentTileLayer.addTo(map);
    
    console.log(`Switched to ${viewType} view`);
    closeViewsSubmenu();
  });
});

// Unified Search functionality
const searchModeToggle = document.getElementById('searchModeToggle');
const searchModeDropdown = document.getElementById('searchModeDropdown');
const searchModeIcon = document.getElementById('searchModeIcon');
const mainSearchBar = document.getElementById('mainSearchBar');
const searchModeOptions = document.querySelectorAll('.search-mode-option');
let currentSearchMode = 'community';
let locationMarker = null;

function toggleSearchModeDropdown() {
  searchModeDropdown.classList.toggle('active');
}

function closeSearchModeDropdown() {
  searchModeDropdown.classList.remove('active');
}

searchModeToggle.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleSearchModeDropdown();
});

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
  if (!searchModeDropdown.contains(e.target) && !searchModeToggle.contains(e.target)) {
    closeSearchModeDropdown();
  }
});

searchModeOptions.forEach(option => {
  option.addEventListener('click', () => {
    const mode = option.dataset.mode;
    currentSearchMode = mode;
    
    // Update active state
    searchModeOptions.forEach(opt => opt.classList.remove('active'));
    option.classList.add('active');
    
    // Update icon and placeholder
    if (mode === 'community') {
      searchModeIcon.textContent = '👥';
      mainSearchBar.placeholder = 'Search Community...';
    } else {
      searchModeIcon.textContent = '📍';
      mainSearchBar.placeholder = 'Search Location...';
    }
    
    mainSearchBar.value = '';
    mainSearchBar.focus();
    closeSearchModeDropdown();
  });
});

mainSearchBar.addEventListener('keydown', async (e) => {
  if (e.key === 'Enter') {
    const query = mainSearchBar.value.trim();
    if (!query) return;
    
    if (currentSearchMode === 'location') {
      try {
        // Use Nominatim API for geocoding
        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`,
          { headers: { 'Accept': 'application/json' } }
        );
        const results = await response.json();
        
        if (results && results.length > 0) {
          const { lat, lon, display_name } = results[0];
          
          // Move map to location
          map.setView([parseFloat(lat), parseFloat(lon)], 15);
          
          // Remove previous location marker if exists
          if (locationMarker) {
            map.removeLayer(locationMarker);
          }
          
          // Add marker at location
          locationMarker = L.marker([parseFloat(lat), parseFloat(lon)])
            .addTo(map)
            .bindPopup(display_name)
            .openPopup();
          
          // Blur the input
          mainSearchBar.blur();
          
          console.log(`Location found: ${display_name}`);
        } else {
          alert('Location not found. Please try a different search.');
        }
      } catch (error) {
        console.error('Geocoding error:', error);
        alert('Error searching for location. Please try again.');
      }
    } else {
      // Community search
      console.log(`Searching for community: ${query}`);
      // TODO: Implement community search
    }
  }
});

// Compass functionality
const compassButton = document.getElementById('compassButton');

compassButton.addEventListener('click', () => {
  // Reset map to north orientation
  map.setBearing && map.setBearing(0);
  console.log('Compass: Resetting to North');
});
