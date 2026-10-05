CASES = [
    {'name': 'is_admin_user admin/user/anon',
     'steps': [{'as': 'admin', 'rpc': 'is_admin_user'},
               {'as': 'agon.begolli@gmail.com', 'rpc': 'is_admin_user'},
               {'as': None, 'rpc': 'is_admin_user'}]},
    {'name': 'can_see_city / is_premium',
     'steps': [{'as': 'agon.begolli@gmail.com', 'rpc': 'can_see_city', 'args': {'p_city': 'Ferizaj'}},
               {'as': 'agon.begolli@gmail.com', 'rpc': 'can_see_city', 'args': {'p_city': 'Pejë'}},
               {'as': 'admin', 'rpc': 'can_see_city', 'args': {'p_city': 'Pejë'}},
               {'as': 'agon.begolli@gmail.com', 'rpc': 'is_premium', 'args': {'p_user': '$user:admin'}},
               {'as': None, 'rpc': 'is_premium', 'args': {'p_user': '$user:admin'}},
               {'as': 'agon.begolli@gmail.com', 'rpc': 'is_premium', 'args': {'p_user': 'nope'}},
               {'as': 'agon.begolli@gmail.com', 'rpc': 'is_premium', 'args': {}}]},
]
