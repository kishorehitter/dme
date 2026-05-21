export interface User {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  display_name: string;
  username: string;
  profile_picture: string | null;
  avatar_sticker: string | null;
  status: string;
  last_seen: string;
  is_verified: boolean;
  last_username_change: string | null;
}
export interface Message {
  id: number;
  conversation: number;
  sender: {
    id: number;
    email: string;
    display_name: string;
    profile_picture: string | null;
    avatar_sticker: string | null;
    status?: string;
    last_seen?: string;
  };
  content: string;
  message_type: 'text' | 'image' | 'video' | 'audio' | 'document';
  media_file: string | null;
  is_read: boolean;
  delivered_at: string | null;  // When message reached receiver's device (from backend)
  created_at: string;
  edited_at: string | null;
  reply_to?: Message | null;
}

export interface Conversation {
  id: number;
  name: string | null;
  is_group: boolean;
  profile_picture: string | null;
  other_user: User | null;
  last_message: {
    id: number;
    content: string;
    message_type: string;
    created_at: string;
    sender_id: number;
  } | null;
  unread_count: number;
  updated_at: string;
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
}

export interface AuthResponse {
  message: string;
  access_token: string;
  refresh_token: string;
  user: User;
}

export interface OTPRequest {
  email: string;
}

export interface OTPVerify {
  email: string;
  code: string;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterData {
  email: string;
  password: string;
  password_confirm: string;
  first_name: string;
  last_name: string;
}
