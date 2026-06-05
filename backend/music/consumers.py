# backend/music/consumers.py
# NEW FILE — doesn't touch your existing code

import json
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
                'participants': {},
                'current_video': None,
                'position': 0,
                'is_playing': False,
                'queue': []
            }

        # Add participant
        music_rooms[self.room_code]['participants'][self.user.id] = {
            'user_id': self.user.id,
            'name': self.user.display_name,
            'is_dj': self.user.id == music_rooms[self.room_code]['host_id']
        }

        await self.channel_layer.group_add(
            self.room_group_name,
            self.channel_name
        )
        await self.accept()

        # Send current room state to new joiner
        room = music_rooms[self.room_code]
        await self.send(text_data=json.dumps({
            'type': 'room_state',
            'data': {
                'room_code': self.room_code,
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
        if hasattr(self, 'room_code') and self.room_code in music_rooms:
            room = music_rooms[self.room_code]

            # Remove participant
            room['participants'].pop(self.user.id, None)

            # If host leaves pass DJ to next person
            if room['host_id'] == self.user.id:
                remaining = list(room['participants'].keys())
                if remaining:
                    room['host_id'] = remaining[0]
                    room['participants'][remaining[0]]['is_dj'] = True
                else:
                    # Empty room — cleanup
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

        await self.channel_layer.group_discard(
            self.room_group_name,
            self.channel_name
        )

    async def receive(self, text_data):
        data = json.loads(text_data)
        msg_type = data.get('type')

        room = music_rooms.get(self.room_code)
        if not room:
            return

        is_dj = room['host_id'] == self.user.id

        if msg_type == 'watch_load' and is_dj:
            room['current_video'] = data['video']
            room['position'] = 0
            room['is_playing'] = False
            await self.channel_layer.group_send(
                self.room_group_name,
                {'type': 'watch_load', 'video': data['video']}
            )

        elif msg_type == 'watch_sync' and is_dj:
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
                await self.channel_layer.group_send(
                    self.room_group_name,
                    {'type': 'aux_passed', 'next_song': next_song}
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
                    'user': self.user.display_name or self.user.email,
                    'text': data['text']
                }
            )

    # Channel layer event handlers
    async def chat_message(self, event):
        await self.send(text_data=json.dumps({
            'type': 'chat_message',
            'data': {
                'user': event['user'],
                'text': event['text']
            }
        }))

    async def watch_load(self, event):
        await self.send(text_data=json.dumps({
            'type': 'watch_load',
            'data': {'video': event['video']}
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
            'data': {'next_song': event['next_song']}
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