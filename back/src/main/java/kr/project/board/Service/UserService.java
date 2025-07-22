package kr.project.board.Service;

import org.springframework.stereotype.Service;

import kr.project.board.domain.UserDTO;
import kr.project.repository.UserRepositroy;
import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
public class UserService {

    private final UserRepositroy userRepositroy;

    public void regist(UserDTO dto){

    }
    
}
