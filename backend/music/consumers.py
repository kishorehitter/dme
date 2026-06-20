# backend/music/consumers.py
# NEW FILE — doesn't touch your existing code

import json
import uuid
from channels.generic.websocket import AsyncWebsocketConsumer
from rest_framework_simplejwt.tokens import AccessToken
from channels.db import database_sync_to_async

# In-memory room state (fine for prototype)
music_rooms = {}

class MusicConsumer(AsyncWebsocketConsumer):

    async def connect(self):
        self.user = await self.get_user_from_token()
        if not self.user or not self.user.is_authenticated:
            await self.close(code=4001)
            return

        self.room_code = self.scope['url_route']['kwargs']['room_code']
        self.room_group_name = f'music_{self.room_code}'

        # Initialize room if not exists
        if self.room_code not in music_rooms:
            music_rooms[self.room_code] = {
                'host_id': self.user.id,
                'room_name': '', # ✅ Added
                'participants': {},
                'current_video': None,
                'position': 0,
                'is_playing': False,
                'queue': [],
                'is_dj_background': False # ✅ NEW
            }

        # Add participant
        music_rooms[self.room_code]['participants'][self.user.id] = {
            'user_id': self.user.id,
            'name': self.user.computed_display_name, # ✅ Use better name
            'avatar': self.user.clean_profile_picture_url, # ✅ Add avatar
            'avatar_sticker': self.user.avatar_sticker, # ✅ Add sticker
            'is_dj': self.user.id == music_rooms[self.room_code]['host_id']
        }

        await self.channel_layer.group_add(
            self.room_group_name,
            self.channel_name
        )
        await self.accept()

        # Notify others someone joined
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'chat_message',
                'id': str(uuid.uuid4()),
                'user': 'System',
                'text': f"{self.user.computed_display_name} has joined",
                'message_type': 'system'
            }
        )

        # Send current room state to new joiner
        room = music_rooms[self.room_code]
        await self.send(text_data=json.dumps({
            'type': 'room_state',
            'data': {
                'room_code': self.room_code,
                'room_name': room['room_name'], # ✅ Added
                'is_dj': self.user.id == room['host_id'],
                'current_video': room['current_video'],
                'position': room['position'],
                'is_playing': room['is_playing'],
                'queue': room['queue'],
                'participants': list(room['participants'].values())
            }
        }))

        # Notify others someone joined
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'participant_update',
                'participants': list(room['participants'].values())
            }
        )

    async def disconnect(self, close_code):
        if hasattr(self, 'room_code') and hasattr(self, 'room_group_name') and self.room_code in music_rooms:
            room = music_rooms[self.room_code]

            # Remove participant
            room['participants'].pop(self.user.id, None)

            # Notify others someone left
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'chat_message',
                    'id': str(uuid.uuid4()),
                    'user': 'System',
                    'text': f"{self.user.computed_display_name} has left",
                    'message_type': 'system'
                }
            )

            # If host leaves pass DJ to next person
            if room['host_id'] == self.user.id:
                remaining = list(room['participants'].keys())
                if remaining:
                    room['host_id'] = remaining[0]
                    room['participants'][remaining[0]]['is_dj'] = True
                else:
                    # Empty room — cleanup
                    await self.cleanup_volatile_media()
                    del music_rooms[self.room_code]

            if self.room_code in music_rooms:
                await self.channel_layer.group_send(
                    self.room_group_name,
                    {
                        'type': 'participant_update',
                        'participants': list(
                            music_rooms[self.room_code]['participants'].values()
                        )
                    }
                )

        if hasattr(self, 'room_group_name'):
            await self.channel_layer.group_discard(
                self.room_group_name,
                self.channel_name
            )

    async def cleanup_volatile_media(self):
        """Deletes all files associated with this room from Cloudinary."""
        import cloudinary.api
        
        folder_path = f"music_chat_media/room_{self.room_code}"
        
        try:
            # Delete all resources in the room's folder
            result = cloudinary.api.delete_resources_by_prefix(folder_path, resource_type="image")
            # Try to delete the folder itself if empty
            cloudinary.api.delete_folder(folder_path)
            print(f"🧹 Cloudinary volatile media cleaned up for room {self.room_code}: {result}")
        except Exception as e:
            print(f"Error during Cloudinary volatile cleanup: {e}")

    async def receive(self, text_data):
        data = json.loads(text_data)
        msg_type = data.get('type')

        room = music_rooms.get(self.room_code)
        if not room:
            return

        is_dj = room['host_id'] == self.user.id

        if msg_type == 'watch_load' and is_dj:
            room['current_video'] = data['video']
            room['room_name'] = data.get('room_name', room['room_name']) # ✅ Update name
            room['position'] = 0
            room['is_playing'] = False
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'watch_load', 
                    'video': data['video'],
                    'room_name': room['room_name'] # ✅ Broadcast name
                }
            )

        elif msg_type == 'watch_sync' and is_dj:
            if room.get('is_dj_background'): # ✅ Source guard: do not broadcast if DJ is backgrounded
                return
            room['position'] = data['position']
            room['is_playing'] = data['is_playing']
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'watch_sync',
                    'position': data['position'],
                    'is_playing': data['is_playing'],
                    'host_timestamp': data['host_timestamp']
                }
            )

        elif msg_type == 'queue_add':
            room['queue'].append(data['song'])
            await self.channel_layer.group_send(
                self.room_group_name,
                {'type': 'queue_update', 'queue': room['queue']}
            )

        elif msg_type == 'pass_aux' and is_dj:
            if room['queue']:
                next_song = room['queue'].pop(0)

                # ✅ Update room state so late joiners get the correct song
                room['current_video'] = next_song
                room['position'] = 0
                room['is_playing'] = True

                await self.channel_layer.group_send(
                    self.room_group_name,
                    {
                        'type': 'aux_passed', 
                        'next_song': next_song,
                        'room_name': room['room_name']
                    }
                )
            await self.channel_layer.group_send(
                self.room_group_name,
                {'type': 'queue_update', 'queue': room['queue']}
            )

        elif msg_type == 'chat_message':
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'chat_message',
                    'id': str(uuid.uuid4()),
                    'user': self.user.display_name or self.user.email,
                    'text': data.get('text', ''),
                    'reply_to': data.get('reply_to'),
                    'media_url': data.get('media_url'),
                    'message_type': data.get('message_type', 'text')
                }
            )

        elif msg_type == 'reaction':
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'reaction',
                    'user': self.user.display_name or self.user.email,
                    'message_id': data['messageId'],
                    'reaction': data['reaction']
                }
            )

        elif msg_type == 'room_name_update' and is_dj:
            room['room_name'] = data['room_name']
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'room_name_update',
                    'room_name': data['room_name']
                }
            )

        elif msg_type == 'dj_background' and is_dj:
            room['position'] = data['position'] # Update DJ position
            room['is_dj_background'] = data['is_background'] # ✅ Update state
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'dj_background',
                    'is_background': data['is_background'],
                    'position': data['position']
                }
            )

        elif msg_type == 'typing':
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'typing_indicator',
                    'user_id': self.user.id,
                    'user_name': self.user.display_name or self.user.email,
                    'is_typing': data.get('is_typing', True)
                }
            )

    # Channel layer event handlers
    async def typing_indicator(self, event):
        await self.send(text_data=json.dumps({
            'type': 'typing',
            'data': {
                'user_id': event['user_id'],
                'user_name': event['user_name'],
                'is_typing': event['is_typing']
            }
        }))

    async def dj_background(self, event):
        await self.send(text_data=json.dumps({
            'type': 'dj_background',
            'data': {
                'is_background': event['is_background'],
                'position': event['position'],
                'is_dj_background': True # Helper for client
            }
        }))

    async def room_name_update(self, event):
        await self.send(text_data=json.dumps({
            'type': 'room_name_update',
            'data': {'room_name': event['room_name']}
        }))

    async def chat_message(self, event):
        await self.send(text_data=json.dumps({
            'type': 'chat_message',
            'data': {
                'id': event.get('id'),
                'user': event['user'],
                'text': event['text'],
                'reply_to': event.get('reply_to'),
                'media_url': event.get('media_url'),
                'message_type': event.get('message_type', 'text')
            }
        }))

    async def reaction(self, event):
        await self.send(text_data=json.dumps({
            'type': 'reaction',
            'data': {
                'user': event['user'],
                'message_id': event['message_id'],
                'reaction': event['reaction']
            }
        }))

    async def watch_load(self, event):
        await self.send(text_data=json.dumps({
            'type': 'watch_load',
            'data': {
                'video': event['video'],
                'room_name': event.get('room_name')
            }
        }))

    async def watch_sync(self, event):
        await self.send(text_data=json.dumps({
            'type': 'watch_sync',
            'data': {
                'position': event['position'],
                'is_playing': event['is_playing'],
                'host_timestamp': event['host_timestamp']
            }
        }))

    async def queue_update(self, event):
        await self.send(text_data=json.dumps({
            'type': 'queue_update',
            'data': {'queue': event['queue']}
        }))

    async def aux_passed(self, event):
        await self.send(text_data=json.dumps({
            'type': 'aux_passed',
            'data': {
                'next_song': event['next_song'],
                'room_name': event.get('room_name')
            }
        }))

    async def participant_update(self, event):
        await self.send(text_data=json.dumps({
            'type': 'participant_update',
            'data': {'participants': event['participants']}
        }))

    async def get_user_from_token(self):
        try:
            query_params = self.scope.get('query_string', b'').decode()
            params = dict(
                param.split('=')
                for param in query_params.split('&')
                if '=' in param
            )
            token = params.get('token', '')
            if not token:
                return None
            access_token = AccessToken(token)
            user_id = access_token['user_id']
            return await self.get_user(user_id)
        except Exception as e:
            print(f"Music WS auth error: {e}")
            return None

    @database_sync_to_async
    def get_user(self, user_id):
        from django.contrib.auth import get_user_model
        User = get_user_model()
        try:
            return User.objects.get(id=user_id)
        except User.DoesNotExist:
            return None