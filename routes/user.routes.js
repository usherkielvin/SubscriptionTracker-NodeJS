import { Router } from 'express';

const userRouter = Router();

userRouter.get('/', (req,res) => {
    res.send({title: 'Users'});
});

userRouter.get('/:userId', (req, res) => {
    res.send({ title: 'User', userId: req.params.userId });
});

userRouter.patch('/:userId', (req, res) => {
    res.send({ title: 'Update user', userId: req.params.userId, updates: req.body });
});

userRouter.delete('/:userId', (req, res) => {
    res.send({ title: 'Delete user', userId: req.params.userId });
});

export default userRouter;
